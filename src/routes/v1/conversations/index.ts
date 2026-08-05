// API_CONTRACT.md §16 -- POST/GET /v1/conversations. Replicates
// getOrCreateConversation/getConversations (conversation.functions.ts)
// since both are requireSupabaseAuth-middleware server functions;
// getApplicationCapabilities/hasAnyActivePremium (plain/middleware-less)
// are reused directly. The calling application is always ctx.appId from
// the caller's own JWT -- never a client-supplied appId, same rule as
// §12's payment reference.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { hasAnyActivePremium } from "@/lib/premium";
import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

const createSchema = z.object({ recipientUserId: z.string().uuid() });

export const Route = createFileRoute("/v1/conversations/")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(createSchema, await readJsonBody(request));
        if (ctx.userId === data.recipientUserId) {
          throw new ApiError("VALIDATION_ERROR", "Cannot start a conversation with yourself.", [
            { field: "recipientUserId", issue: "cannot_message_self" },
          ]);
        }

        const [userAId, userBId] = [ctx.userId, data.recipientUserId].sort();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: existing, error: existingError } = await supabaseAdmin
          .from("conversations")
          .select("*")
          .eq("user_a_id", userAId)
          .eq("user_b_id", userBId)
          .maybeSingle();
        if (existingError) throw new Error(existingError.message);
        if (existing) return apiData({ id: existing.id, createdAt: existing.created_at }, 200);

        const capabilities = await getApplicationCapabilities({ data: { appId: ctx.appId } });
        if (!capabilities.includes("messaging")) {
          throw new ApiError(
            "CAPABILITY_DISABLED",
            "Messaging is not enabled for this application.",
          );
        }
        const [initiatorPremium, recipientPremium] = await Promise.all([
          hasAnyActivePremium(ctx.userId),
          hasAnyActivePremium(data.recipientUserId),
        ]);
        if (!initiatorPremium || !recipientPremium) {
          throw new ApiError(
            "FORBIDDEN",
            "Both users must have active Premium to start a conversation.",
            [{ field: "recipientUserId", issue: "both_users_must_be_premium" }],
          );
        }
        const { data: appSetting } = await supabaseAdmin
          .from("user_app_settings")
          .select("is_contactable")
          .eq("user_id", data.recipientUserId)
          .eq("app_id", ctx.appId)
          .maybeSingle();
        const isContactable = appSetting?.is_contactable ?? true;
        if (!isContactable) {
          throw new ApiError("FORBIDDEN", "This user is not accepting contact right now.", [
            { field: "recipientUserId", issue: "recipient_not_contactable" },
          ]);
        }

        const { data: created, error: createError } = await supabaseAdmin
          .from("conversations")
          .insert({ user_a_id: userAId, user_b_id: userBId })
          .select("*")
          .single();
        if (createError) {
          if (createError.code === "23505") {
            const { data: raceWinner, error: refetchError } = await supabaseAdmin
              .from("conversations")
              .select("*")
              .eq("user_a_id", userAId)
              .eq("user_b_id", userBId)
              .single();
            if (refetchError) throw new Error(refetchError.message);
            return apiData({ id: raceWinner.id, createdAt: raceWinner.created_at }, 200);
          }
          throw new Error(createError.message);
        }
        return apiData({ id: created.id, createdAt: created.created_at }, 201);
      }),

      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: rows, error } = await supabaseAdmin
          .from("conversations")
          .select("*")
          .or(`user_a_id.eq.${ctx.userId},user_b_id.eq.${ctx.userId}`)
          .order("last_message_at", { ascending: false, nullsFirst: false });
        if (error) throw new Error(error.message);
        const conversations = rows ?? [];

        const visible = conversations.filter((c) => {
          const isA = c.user_a_id === ctx.userId;
          const hiddenAt = isA ? c.hidden_by_a_at : c.hidden_by_b_at;
          if (!hiddenAt) return true;
          return !!c.last_message_at && c.last_message_at > hiddenAt;
        });
        if (visible.length === 0) return apiData([]);

        const ids = visible.map((c) => c.id);
        const otherIds = visible.map((c) =>
          c.user_a_id === ctx.userId ? c.user_b_id : c.user_a_id,
        );

        const [{ data: profiles }, { data: lastMessages }, { data: unreadRows }] =
          await Promise.all([
            supabaseAdmin
              .from("profiles_public")
              .select("id, first_name, avatar_url")
              .in("id", otherIds),
            supabaseAdmin
              .from("messages")
              .select("*")
              .in("conversation_id", ids)
              .order("created_at", { ascending: false }),
            supabaseAdmin
              .from("messages")
              .select("conversation_id")
              .in("conversation_id", ids)
              .neq("sender_id", ctx.userId)
              .is("read_at", null),
          ]);

        const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
        const lastMessageByConversation = new Map<
          string,
          NonNullable<typeof lastMessages>[number]
        >();
        for (const m of lastMessages ?? []) {
          if (!lastMessageByConversation.has(m.conversation_id))
            lastMessageByConversation.set(m.conversation_id, m);
        }
        const unreadCountByConversation = new Map<string, number>();
        for (const r of unreadRows ?? []) {
          unreadCountByConversation.set(
            r.conversation_id,
            (unreadCountByConversation.get(r.conversation_id) ?? 0) + 1,
          );
        }

        return apiData(
          visible.map((c, i) => {
            const otherId = otherIds[i];
            const p = profileById.get(otherId);
            const lm = lastMessageByConversation.get(c.id);
            return {
              id: c.id,
              otherUser: p ? { id: p.id, firstName: p.first_name, avatarUrl: p.avatar_url } : null,
              lastMessage: lm
                ? { body: lm.body, senderId: lm.sender_id, createdAt: lm.created_at }
                : null,
              unreadCount: unreadCountByConversation.get(c.id) ?? 0,
            };
          }),
        );
      }),
    },
  },
});
