// API_CONTRACT.md §14 -- POST /v1/me/advertising/campaigns/{campaignId}/checkout-reference.
// Replicates createCampaignCheckoutReference (advertising.functions.ts)
// since it's a requireSupabaseAuth-middleware server function;
// resolvePlacementPriceById/getAdAccountCreditBalance/signCampaignReference
// (all plain functions) are reused directly -- the webhook still re-derives
// everything server-side at fulfillment, these figures are display-only.
import { createFileRoute } from "@tanstack/react-router";

import { getAdAccountCreditBalance, resolvePlacementPriceById } from "@/lib/advertising.server";
import { signCampaignReference } from "@/lib/payment-reference.server";
import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/advertising/campaigns/$campaignId/checkout-reference")(
  {
    server: {
      handlers: {
        POST: withRoute(async ({ request, params }) => {
          const ctx = await requireUserContext(request);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: campaign } = await supabaseAdmin
            .from("ad_campaigns")
            .select("*")
            .eq("id", params.campaignId)
            .eq("user_id", ctx.userId)
            .maybeSingle();
          if (!campaign) throw new ApiError("NOT_FOUND", "Campaign not found.");
          if (campaign.status !== "draft") {
            throw new ApiError("VALIDATION_ERROR", "Campaign is not awaiting payment.", [
              { field: "campaignId", issue: "not_draft" },
            ]);
          }
          if (!campaign.placement_price_id) {
            throw new ApiError("VALIDATION_ERROR", "Campaign has no price reference.", [
              { field: "campaignId", issue: "no_price_reference" },
            ]);
          }

          const price = await resolvePlacementPriceById(campaign.placement_price_id);
          if (!price)
            throw new ApiError("VALIDATION_ERROR", "Invalid placement price.", [
              { field: "campaignId", issue: "invalid_price" },
            ]);

          const creditBalance = await getAdAccountCreditBalance(ctx.userId);
          const creditApplied = Math.min(creditBalance, price.price);
          const expectedAmount = Math.max(0, price.price - creditApplied);

          return apiData({
            reference: signCampaignReference(ctx.userId, campaign.app_id, campaign.id),
            expectedAmount,
            currency: price.currency,
            creditApplied,
            stripePaymentLink: price.stripePaymentLink,
            paypalPaymentLink: price.paypalPaymentLink,
          });
        }),
      },
    },
  },
);
