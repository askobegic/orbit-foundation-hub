// API_CONTRACT.md §14 -- POST /v1/admin/advertising/credit-redemptions/{redemptionId}/fulfill.
// Replicates adminFulfillAdvertisingCreditRedemption (advertising.functions.ts)
// since it's a requireSupabaseAuth-middleware server function -- the
// concrete implementation of Rewards' fulfillment abstraction for
// grantType: "advertising_credit".
import { createFileRoute } from "@tanstack/react-router";

import type { Json } from "@/integrations/supabase/types";
import { writeAuditLog } from "@/lib/admin.server";
import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute(
  "/v1/admin/advertising/credit-redemptions/$redemptionId/fulfill",
)({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: redemption } = await supabaseAdmin
          .from("reward_redemptions")
          .select("*")
          .eq("id", params.redemptionId)
          .maybeSingle();
        if (!redemption) throw new ApiError("NOT_FOUND", "Redemption not found.");

        const grantResult = redemption.grant_result as {
          status?: string;
          grantType?: string;
          grantValue?: { amount?: number; currency?: string };
        } | null;
        if (grantResult?.grantType !== "advertising_credit") {
          throw new ApiError("VALIDATION_ERROR", "This redemption is not an advertising credit.");
        }
        if (grantResult?.status !== "pending_fulfillment") {
          throw new ApiError("CONFLICT", "This redemption has already been fulfilled.");
        }

        const amount = Number(grantResult.grantValue?.amount ?? 0);
        const currency = grantResult.grantValue?.currency ?? "EUR";
        if (amount <= 0)
          throw new ApiError("VALIDATION_ERROR", "Redemption has no creditable amount.");

        const { error: creditErr } = await supabaseAdmin.from("ad_account_credits").insert({
          user_id: redemption.user_id,
          amount,
          currency,
          source: "reward_redemption",
          source_id: redemption.id,
        });
        if (creditErr) throw new Error(creditErr.message);

        const { data: row, error } = await supabaseAdmin
          .from("reward_redemptions")
          .update({
            grant_result: {
              ...grantResult,
              status: "fulfilled",
              fulfilledAt: new Date().toISOString(),
            } as Json,
          })
          .eq("id", params.redemptionId)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "ad_account_credit.fulfill_redemption",
          entityType: "reward_redemption",
          entityId: redemption.id,
          oldData: redemption,
          newData: row,
        });

        return apiData({ amount, currency });
      }),
    },
  },
});
