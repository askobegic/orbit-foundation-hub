// API_CONTRACT.md §8 -- PUT /v1/admin/applications/{appId}/capabilities/{key}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/applications/$appId/capabilities/$key")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("application_capabilities")
          .select("enabled")
          .eq("app_id", params.appId)
          .eq("capability_key", params.key)
          .maybeSingle();

        const { data: row, error } = await supabaseAdmin
          .from("application_capabilities")
          .upsert(
            { app_id: params.appId, capability_key: params.key, enabled: data.enabled },
            { onConflict: "app_id,capability_key" },
          )
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "application_capability.set",
          entityType: "application_capability",
          entityId: row.id,
          oldData: { enabled: previous?.enabled ?? false },
          newData: { enabled: row.enabled },
          reason: data.reason ?? null,
        });

        return apiData({ key: params.key, enabled: row.enabled });
      }),
    },
  },
});
