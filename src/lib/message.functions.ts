// Priority 7: Messaging System -- Message server functions.
//
// Plain text only, immutable once sent (no edit/delete). Reuses the
// existing, single, shared `notifications` table for new-message alerts --
// no parallel messaging-notification system (see PROJECT_KNOWLEDGE.md ->
// Notifications, message-related).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Message } from "@/types/messaging";

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

const getMessagesSchema = z.object({
  conversationId: z.string().uuid(),
  before: z.string().datetime().optional(),
});

export const getMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => getMessagesSchema.parse(raw))
  .handler(async ({ data, context }): Promise<Message[]> => {
    let q = context.supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.before) q = q.lt("created_at", data.before);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    // RLS silently returns zero rows if the caller isn't a participant --
    // matches this codebase's existing convention of relying on RLS for
    // read-access enforcement without a separate explicit check.
    return ((rows ?? []) as MessageRow[]).reverse().map(toMessage);
  });

const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => sendMessageSchema.parse(raw))
  .handler(async ({ data, context }): Promise<Message> => {
    const { data: convo, error: convoError } = await context.supabase
      .from("conversations")
      .select("user_a_id, user_b_id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (convoError) throw new Error(convoError.message);
    if (!convo) throw new Error("Conversation not found");
    if (convo.user_a_id !== context.userId && convo.user_b_id !== context.userId) {
      throw new Error("Not a participant in this conversation");
    }
    const recipientId = convo.user_a_id === context.userId ? convo.user_b_id : convo.user_a_id;

    const { data: inserted, error: insertError } = await context.supabase
      .from("messages")
      .insert({ conversation_id: data.conversationId, sender_id: context.userId, body: data.body })
      .select("*")
      .single();
    if (insertError) throw new Error(insertError.message);

    const { error: bumpError } = await context.supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", data.conversationId);
    if (bumpError) console.error("sendMessage: conversation bump failed", bumpError);

    const { error: notifyError } = await context.supabase.from("notifications").insert({
      user_id: recipientId,
      title_bs: "Nova poruka",
      title_en: "New message",
      title_de: "Neue Nachricht",
      message_bs: "Imate novu poruku.",
      message_en: "You have a new message.",
      message_de: "Sie haben eine neue Nachricht.",
      type: "info",
      app_id: null,
    });
    if (notifyError) console.error("sendMessage: notification insert failed", notifyError);

    return toMessage(inserted as MessageRow);
  });

const markReadSchema = z.object({ conversationId: z.string().uuid() });

export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => markReadSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("conversation_id", data.conversationId)
      .neq("sender_id", context.userId)
      .is("read_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
