// API_CONTRACT.md §17 -- POST /v1/me/notifications/{notificationId}/read.
// Replicates markNotificationRead (notifications.functions.ts) since it's
// a requireSupabaseAuth-middleware server function.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/notifications/$notificationId/read")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("notifications")
          .update({ is_read: true })
          .eq("id", params.notificationId)
          .eq("user_id", ctx.userId);
        if (error) throw new Error(error.message);
        return apiData({ ok: true });
      }),
    },
  },
});
