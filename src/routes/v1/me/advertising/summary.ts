// API_CONTRACT.md §14 -- GET /v1/me/advertising/summary. Replicates
// getMyAdvertisingSummary (advertising.functions.ts) since it's a
// requireSupabaseAuth-middleware server function; checkAdvertiserEligibility
// and getAdAccountCreditBalance (plain functions, advertising.server.ts)
// are reused directly.
import { createFileRoute } from "@tanstack/react-router";

import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { checkAdvertiserEligibility, getAdAccountCreditBalance } from "@/lib/advertising.server";
import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext, resolveAppId } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/advertising/summary")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const url = new URL(request.url);
        const appId = await resolveAppId(request, url, { required: true });

        const capabilities = await getApplicationCapabilities({ data: { appId: appId! } });
        if (!capabilities.includes("advertising")) {
          throw new ApiError(
            "CAPABILITY_DISABLED",
            "Advertising is not enabled for this application.",
          );
        }

        const [{ eligible, rule }, creditBalance] = await Promise.all([
          checkAdvertiserEligibility(ctx.userId, appId!),
          getAdAccountCreditBalance(ctx.userId),
        ]);

        return apiData({ eligible, eligibilityRule: rule, creditBalance });
      }),
    },
  },
});
