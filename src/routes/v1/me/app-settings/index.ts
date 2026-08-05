// API_CONTRACT.md §6 -- GET /v1/me/app-settings.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/app-settings/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("user_app_settings")
          .select("*, app:applications(name)")
          .eq("user_id", ctx.userId);
        if (error) throw new Error(error.message);
        return apiData(
          (data ?? []).map((row) => ({
            appId: row.app_id,
            appName: (row as { app?: { name?: string } }).app?.name ?? null,
            isVisible: row.is_visible,
            isContactable: row.is_contactable,
          })),
        );
      }),
    },
  },
});
