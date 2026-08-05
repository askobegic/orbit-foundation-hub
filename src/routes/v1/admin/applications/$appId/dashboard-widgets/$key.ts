// API_CONTRACT.md §9 -- PUT /v1/admin/applications/{appId}/dashboard-widgets/{key}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/applications/$appId/dashboard-widgets/$key")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("dashboard_widget_settings")
          .select("enabled")
          .eq("app_id", params.appId)
          .eq("widget_key", params.key)
          .maybeSingle();

        const { data: row, error } = await supabaseAdmin
          .from("dashboard_widget_settings")
          .upsert(
            { app_id: params.appId, widget_key: params.key, enabled: data.enabled },
            { onConflict: "widget_key,app_id" },
          )
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "dashboard_widget_setting.set",
          entityType: "dashboard_widget_setting",
          entityId: row.id,
          oldData: { enabled: previous?.enabled ?? true },
          newData: { enabled: row.enabled },
          reason: data.reason ?? null,
        });

        return apiData({ key: params.key, enabled: row.enabled });
      }),
    },
  },
});
