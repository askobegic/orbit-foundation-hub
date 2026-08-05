// API_CONTRACT.md §16 -- POST /v1/conversations/{conversationId}/read.
// Replicates markConversationRead (message.functions.ts) since it's a
// requireSupabaseAuth-middleware server function.
import { createFileRoute } from "@tanstack/react-router";

import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/conversations/$conversationId/read")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: convo } = await supabaseAdmin
          .from("conversations")
          .select("user_a_id, user_b_id")
          .eq("id", params.conversationId)
          .maybeSingle();
        if (!convo || (convo.user_a_id !== ctx.userId && convo.user_b_id !== ctx.userId)) {
          throw new ApiError("NOT_FOUND", "Conversation not found.");
        }

        const { error } = await supabaseAdmin
          .from("messages")
          .update({ read_at: new Date().toISOString() })
          .eq("conversation_id", params.conversationId)
          .neq("sender_id", ctx.userId)
          .is("read_at", null);
        if (error) throw new Error(error.message);

        return apiData({ ok: true });
      }),
    },
  },
});
