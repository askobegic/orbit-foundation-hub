// API_CONTRACT.md §13 -- POST /v1/me/rewards/redeem.
//
// Priority 15 Phase C: this route used to duplicate redeemReward's
// validation/balance-check/insert logic by hand (a /v1 route can't call a
// createServerFn directly) -- exactly the "two places compute the same
// answer differently" pattern CLAUDE.md calls a defect, discovered while
// fixing the redemption TOCTOU (C9 / PR11-13). Both this route and
// redeemReward (rewards.functions.ts) now call the same plain function,
// redeemCatalogReward() (rewards.server.ts), which is also where the
// atomic balance-check-and-insert and fulfillment dispatch live.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import { redeemCatalogReward } from "@/lib/rewards.server";
import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext, resolveAppId } from "@/lib/v1/context.server";

const bodySchema = z.object({ catalogKey: z.string().trim().min(1) });

export const Route = createFileRoute("/v1/me/rewards/redeem")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const url = new URL(request.url);
        const appId = await resolveAppId(request, url, { required: true });
        const data = parseBody(bodySchema, await readJsonBody(request));

        const capabilityKeys = new Set(
          await getApplicationCapabilities({ data: { appId: appId! } }),
        );
        if (!capabilityKeys.has("rewards")) {
          throw new ApiError("CAPABILITY_DISABLED", "Rewards is not enabled for this application.");
        }

        enforceRateLimit(`redeem-reward:${ctx.userId}`, 10, 60 * 1000);

        const result = await redeemCatalogReward({
          userId: ctx.userId,
          catalogKey: data.catalogKey,
          appId,
        });
        if (!result.ok) {
          const issue = result.error;
          throw new ApiError("VALIDATION_ERROR", "Reward not found or unavailable.", [
            { field: "catalogKey", issue },
          ]);
        }

        return apiData(
          {
            redemptionId: result.redemptionId,
            pointsSpent: result.pointsSpent,
            status: result.fulfilled ? "fulfilled" : "pending_fulfillment",
          },
          201,
        );
      }),
    },
  },
});
