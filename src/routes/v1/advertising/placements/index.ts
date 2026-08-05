// API_CONTRACT.md §14 -- GET /v1/advertising/placements. Reuses
// getAdPlacementsForApp directly (advertising.functions.ts) -- it's a
// middleware-less createServerFn, safe to call as a plain function (same
// pattern already established for getApplicationCapabilities/
// getDashboardWidgets). Empty list when 'advertising' is disabled, never
// CAPABILITY_DISABLED -- "no placements" is itself a valid answer here.
import { createFileRoute } from "@tanstack/react-router";

import { getAdPlacementsForApp } from "@/lib/advertising.functions";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { resolveAppId } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/advertising/placements/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const url = new URL(request.url);
        const appId = await resolveAppId(request, url, { required: true });
        const placements = await getAdPlacementsForApp({ data: { appId: appId! } });
        return apiData(
          placements.map((p) => ({
            key: p.key,
            label: p.label,
            prices: p.prices.map((pr) => ({
              id: pr.id,
              durationDays: pr.durationDays,
              price: pr.price,
              currency: pr.currency,
            })),
          })),
        );
      }),
    },
  },
});
