-- Priority 15 Phase D: Admin -> User Communication, User -> Admin Support,
-- and Engagement Notifications. Extends the existing notifications table
-- rather than replacing it; Support gets its own dedicated tables (its
-- lifecycle -- subject/priority/status/replies -- is fundamentally
-- different from the existing one-on-one social Messaging system's
-- eligibility+hide-per-side shape, per the explicit instruction not to
-- misuse conversations/messages for this).

-- ============================================================
-- 1. notifications: category (richer admin-facing classification, kept
--    SEPARATE from the existing `type` column, which stays exactly as-is
--    -- UI severity (info/success/warning/error), used unchanged by
--    NotificationBell today) and target_path (the deep-link capability
--    PROJECT_AUDIT.md -> MSG-3 already flagged as missing).
-- ============================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IS NULL OR category IN ('information', 'reward', 'premium', 'offer', 'warning', 'system'));

-- Internal dashboard paths only -- the same "validate before storage, not
-- just before render" rule PROJECT_AUDIT.md -> CO-1 already established
-- for user-controlled URLs. No external URL, no scheme, ever accepted
-- here; a notification can only ever deep-link inside this application.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS target_path text
    CHECK (target_path IS NULL OR target_path ~ '^/dashboard/[a-zA-Z0-9/_-]*$');

-- ============================================================
-- 2. Support tickets -- a simple ticket/conversation system, NOT the
--    social Messaging system. Different lifecycle on purpose: subject,
--    priority, status, admin-only internal notes.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  category text,
  -- Admin-only settable (see support_messages RLS below and
  -- adminSetSupportTicketPriority) -- a user can never set their own
  -- ticket's priority.
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
  app_id uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);

GRANT SELECT ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- Users see only their own tickets. All writes (create/status/priority)
-- go through service_role after server-side validation -- the same
-- "never trust the caller's own RLS-scoped session for business-rule-
-- gated writes" pattern already established for conversations/messages
-- (PROJECT_AUDIT.md -> PR11-5) -- never a direct client-authenticated
-- insert/update.
DROP POLICY IF EXISTS "Users can view their own support tickets" ON public.support_tickets;
CREATE POLICY "Users can view their own support tickets"
  ON public.support_tickets FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins manage support tickets" ON public.support_tickets;
CREATE POLICY "Admins manage support tickets"
  ON public.support_tickets FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE CASCADE NOT NULL,
  sender_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('user', 'admin')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  -- Admin-only visibility -- the "admin notes" capability, without a
  -- separate table: an internal note is just a support_messages row the
  -- owning user's RLS policy never returns.
  is_internal_note boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON public.support_messages(ticket_id, created_at);

GRANT SELECT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- A user sees only non-internal messages on their own ticket. Never a
-- direct client insert -- replies go through service_role after
-- verifying the caller owns the ticket (or is an admin).
DROP POLICY IF EXISTS "Users can view their own ticket messages" ON public.support_messages;
CREATE POLICY "Users can view their own ticket messages"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    is_internal_note = false
    AND ticket_id IN (SELECT id FROM public.support_tickets WHERE user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Admins manage support messages" ON public.support_messages;
CREATE POLICY "Admins manage support messages"
  ON public.support_messages FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
