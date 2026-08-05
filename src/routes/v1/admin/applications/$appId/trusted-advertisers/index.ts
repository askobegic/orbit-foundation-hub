// API_CONTRACT.md §14 -- GET /v1/admin/applications/{appId}/trusted-advertisers.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/applications/$appId/trusted-advertisers/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request, params }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("ad_trusted_advertisers")
          .select(
            "*, profiles!ad_trusted_advertisers_user_id_fkey(username, first_name, last_name)",
          )
          .eq("app_id", params.appId)
          .order("granted_at", { ascending: false });
        if (error) throw new Error(error.message);

        return apiData(
          (data ?? []).map((r) => ({
            userId: r.user_id,
            userName:
              [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(" ") ||
              r.profiles?.username,
            grantedAt: r.granted_at,
            grantedBy: r.granted_by,
          })),
        );
      }),
    },
  },
});
