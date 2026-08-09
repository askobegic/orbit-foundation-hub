// Priority 7: Messaging System -- Conversation server functions.
//
// One-on-one, text-only, a single Core-wide inbox (no per-application
// partitioning -- see PROJECT_KNOWLEDGE.md -> Text Messaging). Eligibility
// (global Premium on both sides, recipient is_contactable for whichever
// application is current at creation time) is re-verified here, server-side,
// only when a conversation is first created -- never on later messages, so
// an existing conversation keeps working even if one side's Premium later
// lapses.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { hasAnyActivePremium } from "@/lib/premium";
import type { Conversation, ConversationSummary } from "@/types/messaging";

// conversations' RLS INSERT policy was removed (Priority 11 security audit)
// -- it had no way to express "both sides Premium, recipient contactable,
// messaging capability enabled", which this function already checks in
// application code below. The actual row creation goes through
// service_role, exactly like ad_campaigns does for the same reason, so a
// direct REST/Supabase-client call can no longer create a conversation
// bypassing these checks. Reads/hide/updates are unaffected and continue
// through the caller's own session under the existing participant-only
// RLS policies.
async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type ConversationRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  hidden_by_a_at: string | null;
  hidden_by_b_at: string | null;
  last_message_at: string | null;
  created_at: string;
};

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userAId: row.user_a_id,
    userBId: row.user_b_id,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

const getOrCreateSchema = z.object({
  recipientUserId: z.string().uuid(),
  currentAppId: z.string().uuid(),
});

export const getOrCreateConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => getOrCreateSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const initiatorId = context.userId;
    if (initiatorId === data.recipientUserId) {
      throw new Error("Cannot start a conversation with yourself");
    }
    // Canonical ordering: the lexicographically smaller uuid is always
    // user_a_id, so UNIQUE(user_a_id, user_b_id) alone enforces "at most
    // one conversation per pair" regardless of who initiates.
    const [userAId, userBId] = [initiatorId, data.recipientUserId].sort();

    const supabaseAdmin = await adminClient();
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("user_a_id", userAId)
      .eq("user_b_id", userBId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return toConversation(existing as ConversationRow);

    // Eligibility is checked only here, at creation -- never re-checked for
    // an existing conversation (see PROJECT_KNOWLEDGE.md -> Contact Actions).
    // R-2 extends the same "checked once, at creation" rule to the messaging
    // capability itself -- checked against the application the initiator is
    // currently browsing, since a conversation has no per-conversation app_id
    // (see the file-level comment above), matching how Advertising/Rewards
    // gate their own current-application-context actions.
    const capabilities = await getApplicationCapabilities({ data: { appId: data.currentAppId } });
    if (!capabilities.includes("messaging")) {
      throw new Error("Messaging is not available for this application");
    }
    const [initiatorPremium, recipientPremium] = await Promise.all([
      hasAnyActivePremium(initiatorId),
      hasAnyActivePremium(data.recipientUserId),
    ]);
    if (!initiatorPremium || !recipientPremium) {
      throw new Error("Both users must have active Premium to start a conversation");
    }
    const { data: appSetting } = await context.supabase
      .from("user_app_settings")
      .select("is_contactable")
      .eq("user_id", data.recipientUserId)
      .eq("app_id", data.currentAppId)
      .maybeSingle();
    const isContactable = (appSetting as { is_contactable: boolean } | null)?.is_contactable ?? true;
    if (!isContactable) {
      throw new Error("This user is not accepting contact right now");
    }

    const { data: created, error: createError } = await supabaseAdmin
      .from("conversations")
      .insert({ user_a_id: userAId, user_b_id: userBId })
      .select("*")
      .single();
    if (createError) {
      // Two concurrent first-messages between the same pair can both pass
      // the "existing?" check above before either inserts. UNIQUE(user_a_id,
      // user_b_id) correctly rejects the second insert (23505) -- instead of
      // surfacing that as an error to whichever request lost the race,
      // re-fetch and return the row the other request just created, so both
      // callers land in the same conversation.
      if (createError.code === "23505") {
        const { data: raceWinner, error: refetchError } = await supabaseAdmin
          .from("conversations")
          .select("*")
          .eq("user_a_id", userAId)
          .eq("user_b_id", userBId)
          .single();
        if (refetchError) throw new Error(refetchError.message);
        return toConversation(raceWinner as ConversationRow);
      }
      throw new Error(createError.message);
    }
    return toConversation(created as ConversationRow);
  });

export type OtherUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  username: string | null;
};

export const getConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<(ConversationSummary & { otherUser: OtherUser | null })[]> => {
    const userId = context.userId;
    const { data: rows, error } = await context.supabase
      .from("conversations")
      .select("*")
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    const conversations = (rows ?? []) as ConversationRow[];

    // Hidden-by-this-user conversations stay hidden until a newer message
    // arrives (last_message_at moves past the hidden timestamp) -- no
    // separate "unhide" action or column reset needed.
    const visible = conversations.filter((c) => {
      const isA = c.user_a_id === userId;
      const hiddenAt = isA ? c.hidden_by_a_at : c.hidden_by_b_at;
      if (!hiddenAt) return true;
      return !!c.last_message_at && c.last_message_at > hiddenAt;
    });
    if (visible.length === 0) return [];

    const ids = visible.map((c) => c.id);
    const otherIds = visible.map((c) => (c.user_a_id === userId ? c.user_b_id : c.user_a_id));

    const [{ data: profiles }, { data: lastMessages }, { data: unreadRows }] = await Promise.all([
      context.supabase
        .from("profiles_public")
        .select("id, first_name, last_name, avatar_url, username")
        .in("id", otherIds),
      context.supabase
        .from("messages")
        .select("*")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false }),
      context.supabase
        .from("messages")
        .select("conversation_id")
        .in("conversation_id", ids)
        .neq("sender_id", userId)
        .is("read_at", null),
    ]);

    const profileById = new Map(
      ((profiles ?? []) as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        avatar_url: string | null;
        username: string | null;
      }[]).map((p) => [p.id, p]),
    );
    type MessageRow = {
      id: string;
      conversation_id: string;
      sender_id: string;
      body: string;
      created_at: string;
      read_at: string | null;
    };
    const lastMessageByConversation = new Map<string, MessageRow>();
    for (const m of (lastMessages ?? []) as MessageRow[]) {
      if (!lastMessageByConversation.has(m.conversation_id)) {
        lastMessageByConversation.set(m.conversation_id, m);
      }
    }
    const unreadCountByConversation = new Map<string, number>();
    for (const r of unreadRows ?? []) {
      unreadCountByConversation.set(
        r.conversation_id,
        (unreadCountByConversation.get(r.conversation_id) ?? 0) + 1,
      );
    }

    return visible.map((c, i) => {
      const otherId = otherIds[i];
      const p = profileById.get(otherId);
      const lm = lastMessageByConversation.get(c.id);
      return {
        ...toConversation(c),
        lastMessage: lm
          ? {
              id: lm.id,
              conversationId: lm.conversation_id,
              senderId: lm.sender_id,
              body: lm.body,
              createdAt: lm.created_at,
              readAt: lm.read_at,
            }
          : null,
        unreadCount: unreadCountByConversation.get(c.id) ?? 0,
        otherUser: p
          ? {
              id: p.id!,
              firstName: p.first_name,
              lastName: p.last_name,
              avatarUrl: p.avatar_url,
              username: p.username,
            }
          : null,
      };
    });
  });

const hideSchema = z.object({ conversationId: z.string().uuid() });

export const hideConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => hideSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: convo, error: fetchError } = await context.supabase
      .from("conversations")
      .select("user_a_id, user_b_id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (fetchError) throw new Error(fetchError.message);
    if (!convo) throw new Error("Conversation not found");
    const isA = convo.user_a_id === context.userId;
    const patch = isA ? { hidden_by_a_at: new Date().toISOString() } : { hidden_by_b_at: new Date().toISOString() };
    const { error } = await context.supabase
      .from("conversations")
      .update(patch)
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
