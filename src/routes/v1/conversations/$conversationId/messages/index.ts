// API_CONTRACT.md §16 -- GET/POST /v1/conversations/{conversationId}/messages.
// Replicates getMessages/sendMessage (message.functions.ts) since both are
// requireSupabaseAuth-middleware server functions; participant checks
// replicated explicitly since service_role bypasses RLS (the original
// relied on RLS silently returning zero rows for non-participants).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import type { supabaseAdmin as SupabaseAdminClient } from "@/integrations/supabase/client.server";
import {
  ApiError,
  apiData,
  apiList,
  decodeCursor,
  encodeCursor,
  parseBody,
  parseLimit,
  readJsonBody,
  withRoute,
} from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

async function assertParticipant(
  supabaseAdmin: typeof SupabaseAdminClient,
  conversationId: string,
  userId: string,
) {
  const { data: convo } = await supabaseAdmin
    .from("conversations")
    .select("user_a_id, user_b_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!convo || (convo.user_a_id !== userId && convo.user_b_id !== userId)) {
    throw new ApiError("NOT_FOUND", "Conversation not found.");
  }
  return convo;
}

const sendSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export const Route = createFileRoute("/v1/conversations/$conversationId/messages/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request, params }) => {
        const ctx = await requireUserContext(request);
        const url = new URL(request.url);
        const limit = parseLimit(url);
        const cursor = decodeCursor<{ createdAt: string }>(url.searchParams.get("cursor"));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await assertParticipant(supabaseAdmin, params.conversationId, ctx.userId);

        let query = supabaseAdmin
          .from("messages")
          .select("*")
          .eq("conversation_id", params.conversationId)
          .order("created_at", { ascending: false })
          .limit(limit + 1);
        if (cursor) query = query.lt("created_at", cursor.createdAt);
        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const rows = data ?? [];
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const oldestFirst = [...page].reverse();

        return apiList(
          oldestFirst.map((m) => ({
            id: m.id,
            senderId: m.sender_id,
            body: m.body,
            createdAt: m.created_at,
            readAt: m.read_at,
          })),
          {
            nextCursor: hasMore
              ? encodeCursor({ createdAt: page[page.length - 1].created_at })
              : null,
            hasMore,
          },
        );
      }),

      POST: withRoute(async ({ request, params }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(sendSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const convo = await assertParticipant(supabaseAdmin, params.conversationId, ctx.userId);
        const recipientId = convo.user_a_id === ctx.userId ? convo.user_b_id : convo.user_a_id;

        const { data: inserted, error: insertError } = await supabaseAdmin
          .from("messages")
          .insert({
            conversation_id: params.conversationId,
            sender_id: ctx.userId,
            body: data.body,
          })
          .select("*")
          .single();
        if (insertError) throw new Error(insertError.message);

        const { error: bumpError } = await supabaseAdmin
          .from("conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", params.conversationId);
        if (bumpError) console.error("[v1] messages.send: conversation bump failed", bumpError);

        const { error: notifyError } = await supabaseAdmin.from("notifications").insert({
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
        if (notifyError)
          console.error("[v1] messages.send: notification insert failed", notifyError);

        return apiData(
          {
            id: inserted.id,
            senderId: inserted.sender_id,
            body: inserted.body,
            createdAt: inserted.created_at,
            readAt: inserted.read_at,
          },
          201,
        );
      }),
    },
  },
});
