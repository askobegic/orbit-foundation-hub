// API_CONTRACT.md §16 -- POST /v1/conversations/{conversationId}/hide.
// Replicates hideConversation (conversation.functions.ts) since it's a
// requireSupabaseAuth-middleware server function; participant check
// replicated explicitly since service_role bypasses RLS.
import { createFileRoute } from "@tanstack/react-router";

import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/conversations/$conversationId/hide")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: convo, error: fetchError } = await supabaseAdmin
          .from("conversations")
          .select("user_a_id, user_b_id")
          .eq("id", params.conversationId)
          .maybeSingle();
        if (fetchError) throw new Error(fetchError.message);
        if (!convo || (convo.user_a_id !== ctx.userId && convo.user_b_id !== ctx.userId)) {
          throw new ApiError("NOT_FOUND", "Conversation not found.");
        }

        const isA = convo.user_a_id === ctx.userId;
        const patch = isA
          ? { hidden_by_a_at: new Date().toISOString() }
          : { hidden_by_b_at: new Date().toISOString() };
        const { error } = await supabaseAdmin
          .from("conversations")
          .update(patch)
          .eq("id", params.conversationId);
        if (error) throw new Error(error.message);

        return apiData({ ok: true });
      }),
    },
  },
});
