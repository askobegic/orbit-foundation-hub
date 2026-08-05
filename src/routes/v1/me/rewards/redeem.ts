// API_CONTRACT.md §13 -- POST /v1/me/rewards/redeem. Replicates
// redeemReward (rewards.functions.ts) since it's a requireSupabaseAuth-
// middleware server function; same validation order, same
// pending_fulfillment recording -- Rewards records, it never fulfills.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { writeAuditLog } from "@/lib/admin.server";
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: item } = await supabaseAdmin
          .from("reward_catalog")
          .select("*")
          .eq("key", data.catalogKey)
          .eq("enabled", true)
          .eq("archived", false)
          .maybeSingle();
        if (!item) {
          throw new ApiError("VALIDATION_ERROR", "Reward not found or unavailable.", [
            { field: "catalogKey", issue: "reward_unavailable" },
          ]);
        }
        if (item.requires_capability && !capabilityKeys.has(item.requires_capability)) {
          throw new ApiError("VALIDATION_ERROR", "Reward not found or unavailable.", [
            { field: "catalogKey", issue: "reward_unavailable" },
          ]);
        }

        const [{ data: ledgerRows }, { data: redemptionRows }] = await Promise.all([
          supabaseAdmin.from("reward_ledger").select("points").eq("user_id", ctx.userId),
          supabaseAdmin.from("reward_redemptions").select("points_spent").eq("user_id", ctx.userId),
        ]);
        const lifetimePoints = (ledgerRows ?? []).reduce((sum, r) => sum + r.points, 0);
        const redeemedPoints = (redemptionRows ?? []).reduce((sum, r) => sum + r.points_spent, 0);
        const rewardPoints = lifetimePoints - redeemedPoints;
        if (rewardPoints < item.points_cost) {
          throw new ApiError("VALIDATION_ERROR", "Not enough Reward Points.", [
            { field: "catalogKey", issue: "not_enough_points" },
          ]);
        }

        const { count: verifiedReferrals } = await supabaseAdmin
          .from("premium_referrals")
          .select("id", { count: "exact", head: true })
          .eq("referrer_id", ctx.userId)
          .not("verified_at", "is", null);
        if ((verifiedReferrals ?? 0) < item.verified_referrals_required) {
          throw new ApiError("VALIDATION_ERROR", "Not enough Verified Premium Referrals.", [
            { field: "catalogKey", issue: "not_enough_verified_referrals" },
          ]);
        }

        const { data: row, error } = await supabaseAdmin
          .from("reward_redemptions")
          .insert({
            user_id: ctx.userId,
            catalog_key: item.key,
            points_spent: item.points_cost,
            verified_referrals_at_redemption: verifiedReferrals ?? 0,
            grant_result: {
              status: "pending_fulfillment",
              grantType: item.grant_type,
              grantValue: item.grant_value,
            },
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: ctx.userId,
          action: "reward.redeem",
          entityType: "reward_redemption",
          entityId: row.id,
          newData: row,
        });

        return apiData(
          { redemptionId: row.id, pointsSpent: row.points_spent, status: "pending_fulfillment" },
          201,
        );
      }),
    },
  },
});
