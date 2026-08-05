// API_CONTRACT.md §8 -- GET /v1/admin/applications/{appId}/capabilities.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/applications/$appId/capabilities/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request, params }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const [{ data: definitions, error: defError }, { data: settings, error: settingsError }] =
          await Promise.all([
            supabaseAdmin
              .from("capability_definitions")
              .select("*")
              .eq("archived", false)
              .order("display_order", { ascending: true }),
            supabaseAdmin
              .from("application_capabilities")
              .select("capability_key, enabled")
              .eq("app_id", params.appId),
          ]);
        if (defError) throw new Error(defError.message);
        if (settingsError) throw new Error(settingsError.message);

        const enabledByKey = new Map((settings ?? []).map((s) => [s.capability_key, s.enabled]));
        return apiData(
          (definitions ?? []).map((d) => ({
            key: d.key,
            label: d.label,
            enabled: enabledByKey.get(d.key) ?? false,
          })),
        );
      }),
    },
  },
});
