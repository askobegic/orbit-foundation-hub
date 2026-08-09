// API_CONTRACT.md §14 -- GET /v1/advertising/placements/{placementKey}/active-ad.
// Reuses getActivePlacementAd directly (middleware-less createServerFn).
// Priority 13, Phase D1: accepts an optional ?device=desktop|mobile query
// param -- omitted entirely, behavior is unchanged from before D1.
import { createFileRoute } from "@tanstack/react-router";

import { getActivePlacementAd } from "@/lib/advertising.functions";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { resolveAppId } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/advertising/placements/$placementKey/active-ad")({
  server: {
    handlers: {
      GET: withRoute(async ({ request, params }) => {
        const url = new URL(request.url);
        const appId = await resolveAppId(request, url, { required: true });
        const deviceParam = url.searchParams.get("device");
        const device =
          deviceParam === "desktop" || deviceParam === "mobile" ? deviceParam : undefined;
        const ad = await getActivePlacementAd({
          data: { appId: appId!, placementKey: params.placementKey, device },
        });
        return apiData(ad);
      }),
    },
  },
});
