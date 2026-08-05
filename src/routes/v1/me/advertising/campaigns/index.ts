// API_CONTRACT.md §14 -- GET/POST /v1/me/advertising/campaigns. Replicates
// getMyCampaigns/createDraftCampaign (advertising.functions.ts) since both
// are requireSupabaseAuth-middleware server functions; every plain
// business-logic helper (expireStaleDraftCampaigns, checkAdvertiserEligibility,
// resolvePlacementPriceById, resolvePlacementPrices, isSafeProfileUrl) is
// reused directly, unchanged.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import {
  checkAdvertiserEligibility,
  expireStaleDraftCampaigns,
  resolvePlacementPriceById,
  resolvePlacementPrices,
} from "@/lib/advertising.server";
import { isSafeProfileUrl } from "@/lib/url";
import {
  ApiError,
  apiData,
  apiList,
  parseBody,
  readJsonBody,
  withRoute,
} from "@/lib/v1/http.server";
import { requireUserContext, resolveAppId } from "@/lib/v1/context.server";

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

const createSchema = z.object({
  placementPriceId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  imageUrl: z.string().trim().nullable().optional(),
  linkUrl: z.string().trim().nullable().optional(),
});

export const Route = createFileRoute("/v1/me/advertising/campaigns/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const url = new URL(request.url);
        const status = url.searchParams.get("status");

        await expireStaleDraftCampaigns(ctx.userId);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let query = supabaseAdmin.from("ad_campaigns").select("*").eq("user_id", ctx.userId);
        if (status) query = query.eq("status", status);
        const { data, error } = await query.order("created_at", { ascending: false });
        if (error) throw new Error(error.message);

        return apiList((data ?? []).map(toCampaign), { nextCursor: null, hasMore: false });
      }),

      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const url = new URL(request.url);
        const appId = await resolveAppId(request, url, { required: true });
        const data = parseBody(createSchema, await readJsonBody(request));

        const capabilities = await getApplicationCapabilities({ data: { appId: appId! } });
        if (!capabilities.includes("advertising")) {
          throw new ApiError(
            "CAPABILITY_DISABLED",
            "Advertising is not enabled for this application.",
          );
        }

        const { eligible } = await checkAdvertiserEligibility(ctx.userId, appId!);
        if (!eligible)
          throw new ApiError(
            "FORBIDDEN",
            "You are not eligible to create a campaign for this application.",
          );

        const price = await resolvePlacementPriceById(data.placementPriceId);
        if (
          !price ||
          (await resolvePlacementPrices(appId!, price.placementKey)).every((p) => p.id !== price.id)
        ) {
          throw new ApiError("VALIDATION_ERROR", "Invalid placement price for this application.", [
            { field: "placementPriceId", issue: "invalid" },
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("ad_campaigns")
          .insert({
            user_id: ctx.userId,
            app_id: appId!,
            placement_key: price.placementKey,
            placement_price_id: price.id,
            title: data.title,
            image_url: data.imageUrl ?? null,
            link_url: data.linkUrl ?? null,
            status: "draft",
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        return apiData(toCampaign(row), 201);
      }),
    },
  },
});
