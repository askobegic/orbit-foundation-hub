// API_CONTRACT.md §14 -- POST /v1/admin/advertising/campaigns/{campaignId}/moderate.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const Route = createFileRoute("/v1/admin/advertising/campaigns/$campaignId/moderate")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("ad_campaigns")
          .select("*")
          .eq("id", params.campaignId)
          .maybeSingle();
        if (!previous || previous.status !== "pending") {
          throw new ApiError("CONFLICT", "Campaign is not pending moderation.");
        }

        const { data: row, error } = await supabaseAdmin
          .from("ad_campaigns")
          .update({
            status: data.approve ? "active" : "rejected",
            moderation_note: data.note ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", params.campaignId)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: data.approve ? "ad_campaign.approve" : "ad_campaign.reject",
          entityType: "ad_campaign",
          entityId: row.id,
          oldData: previous,
          newData: row,
          reason: data.note ?? null,
        });

        return apiData({ id: row.id, status: row.status, moderationNote: row.moderation_note });
      }),
    },
  },
});
