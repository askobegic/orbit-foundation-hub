// API_CONTRACT.md §17 -- POST /v1/me/notifications/read-all. Replicates
// markAllNotificationsRead (notifications.functions.ts) since it's a
// requireSupabaseAuth-middleware server function.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/notifications/read-all")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("notifications")
          .update({ is_read: true })
          .eq("user_id", ctx.userId)
          .eq("is_read", false);
        if (error) throw new Error(error.message);
        return apiData({ ok: true });
      }),
    },
  },
});
