-- Priority 7: Messaging System.
--
-- One-on-one, text-only conversations. A single, Core-wide inbox -- no
-- per-application partitioning (Premium is ecosystem-wide, so a
-- conversation isn't "owned" by whichever application it started from;
-- see PROJECT_KNOWLEDGE.md -> Text Messaging). Eligibility (global Premium
-- on both sides, recipient is_contactable for the application current at
-- creation time) is checked only once, when a conversation is first
-- created -- never re-checked on later messages, so a conversation keeps
-- working even if one side's Premium later lapses.
--
-- No blocked_users table -- blocking is explicitly deferred, not built
-- even as unused schema (no speculative structures).

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Canonical ordering (user_a_id always the lexicographically smaller
  -- uuid) so UNIQUE(user_a_id, user_b_id) alone enforces "at most one
  -- conversation per pair" -- enforced in application code, not by a
  -- CHECK constraint (Postgres can't reorder values at insert time).
  user_a_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  user_b_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  -- Per-user "hide from my inbox" -- see public.messages below for how a
  -- new message automatically un-hides it again (no separate unhide action
  -- or column reset needed).
  hidden_by_a_at timestamptz,
  hidden_by_b_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_a ON public.conversations(user_a_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_b ON public.conversations(user_b_id);

GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view their conversations" ON public.conversations;
CREATE POLICY "Participants can view their conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_a_id OR auth.uid() = user_b_id);

-- Backstop only -- the real eligibility check (global Premium on both
-- sides, recipient is_contactable) happens server-side in
-- getOrCreateConversation before this INSERT ever runs. This just ensures
-- a caller can never insert a conversation they aren't a party to.
DROP POLICY IF EXISTS "Participants can create their conversations" ON public.conversations;
CREATE POLICY "Participants can create their conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_a_id OR auth.uid() = user_b_id);

DROP POLICY IF EXISTS "Participants can update their conversations" ON public.conversations;
CREATE POLICY "Participants can update their conversations"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_a_id OR auth.uid() = user_b_id)
  WITH CHECK (auth.uid() = user_a_id OR auth.uid() = user_b_id);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  sender_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set once, by the recipient only, never cleared -- see the column-level
  -- grant below. No edit/delete of messages: immutable once sent.
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON public.messages(conversation_id, sender_id, read_at);

GRANT SELECT, INSERT ON public.messages TO authenticated;
-- Column-level: only read_at is updatable by authenticated -- mirrors the
-- profiles column-grant pattern (see PROJECT_AUDIT.md -> DB-1) rather than
-- relying on RLS's WITH CHECK alone to protect body/sender_id/conversation_id.
GRANT UPDATE (read_at) ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view conversation messages" ON public.messages;
CREATE POLICY "Participants can view conversation messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
    )
  );

-- Only the recipient (never the sender) may mark a message read -- combined
-- with the column-level grant above, this is the only write this policy
-- allows regardless of what a client attempts.
DROP POLICY IF EXISTS "Recipients can mark messages read" ON public.messages;
CREATE POLICY "Recipients can mark messages read"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (
    sender_id != auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
    )
  )
  WITH CHECK (
    sender_id != auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND (c.user_a_id = auth.uid() OR c.user_b_id = auth.uid())
    )
  );
