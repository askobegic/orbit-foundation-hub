// API_CONTRACT.md §14 -- PATCH /v1/me/advertising/campaigns/{campaignId}.
// Replicates updateCampaignCreative (advertising.functions.ts) since it's a
// requireSupabaseAuth-middleware server function; resolveInitialCampaignStatus
// (plain function) is reused directly so an edit re-runs moderation exactly
// like the original.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { resolveInitialCampaignStatus } from "@/lib/advertising.server";
import { writeAuditLog } from "@/lib/admin.server";
import { isSafeProfileUrl } from "@/lib/url";
import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

function toCampaign(row: {
  id: string;
  app_id: string;
  placement_key: string;
  title: string;
  image_url: string | null;
  link_url: string | null;
  status: string;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string | null;
}) {
  return {
    id: row.id,
    appId: row.app_id,
    placementKey: row.placement_key,
    title: row.title,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    status: row.status,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  imageUrl: z.string().trim().nullable().optional(),
  linkUrl: z.string().trim().nullable().optional(),
});

export const Route = createFileRoute("/v1/me/advertising/campaigns/$campaignId/")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: campaign } = await supabaseAdmin
          .from("ad_campaigns")
          .select("*")
          .eq("id", params.campaignId)
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (!campaign) throw new ApiError("NOT_FOUND", "Campaign not found.");
        if (campaign.status === "ended" || campaign.status === "cancelled") {
          throw new ApiError("VALIDATION_ERROR", "This campaign can no longer be edited.", [
            { field: "campaignId", issue: "campaign_ended" },
          ]);
        }

        if (data.linkUrl && !isSafeProfileUrl(data.linkUrl)) {
          throw new ApiError("VALIDATION_ERROR", "Invalid link URL.", [
            { field: "linkUrl", issue: "unsafe_url" },
          ]);
        }
        if (data.imageUrl && !isSafeProfileUrl(data.imageUrl)) {
          throw new ApiError("VALIDATION_ERROR", "Invalid image URL.", [
            { field: "imageUrl", issue: "unsafe_url" },
          ]);
        }

        const patch: {
          title: string;
          image_url: string | null;
          link_url: string | null;
          updated_at: string;
          status?: "pending" | "active";
          moderation_note?: null;
        } = {
          title: data.title ?? campaign.title,
          image_url: data.imageUrl !== undefined ? data.imageUrl : campaign.image_url,
          link_url: data.linkUrl !== undefined ? data.linkUrl : campaign.link_url,
          updated_at: new Date().toISOString(),
        };
        if (campaign.status !== "draft") {
          patch.status = await resolveInitialCampaignStatus(ctx.userId, campaign.app_id);
          patch.moderation_note = null;
        }

        const { data: row, error } = await supabaseAdmin
          .from("ad_campaigns")
          .update(patch)
          .eq("id", campaign.id)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: ctx.userId,
          action: "ad_campaign.update_creative",
          entityType: "ad_campaign",
          entityId: row.id,
          oldData: campaign,
          newData: row,
        });

        return apiData(toCampaign(row));
      }),
    },
  },
});
