// API_CONTRACT.md §14 -- PUT /v1/admin/applications/{appId}/trusted-advertisers/{userId}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  trusted: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/applications/$appId/trusted-advertisers/$userId")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (data.trusted) {
          const { error } = await supabaseAdmin
            .from("ad_trusted_advertisers")
            .upsert(
              { user_id: params.userId, app_id: params.appId, granted_by: admin.userId },
              { onConflict: "user_id,app_id" },
            );
          if (error) throw new Error(error.message);
        } else {
          const { error } = await supabaseAdmin
            .from("ad_trusted_advertisers")
            .delete()
            .eq("user_id", params.userId)
            .eq("app_id", params.appId);
          if (error) throw new Error(error.message);
        }

        await writeAuditLog({
          userId: admin.userId,
          action: data.trusted ? "ad_trusted_advertiser.grant" : "ad_trusted_advertiser.revoke",
          entityType: "ad_trusted_advertiser",
          entityId: params.userId,
          newData: { appId: params.appId },
          reason: data.reason ?? null,
        });

        return apiData({ userId: params.userId, appId: params.appId, trusted: data.trusted });
      }),
    },
  },
});
