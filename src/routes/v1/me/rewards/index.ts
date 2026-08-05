// API_CONTRACT.md §13 -- GET /v1/me/rewards. The /v1 equivalent of
// getRewardsMe (rewards.functions.ts) -- same aggregation, replicated here
// since getRewardsMe is a requireSupabaseAuth-middleware server function
// expecting a raw Supabase session JWT. promotePendingReferralVerifications
// and grantRewardAction (plain functions, rewards.server.ts) and
// getApplicationCapabilities (middleware-less createServerFn,
// capabilities.functions.ts) are reused directly.
import { createFileRoute } from "@tanstack/react-router";

import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { promotePendingReferralVerifications } from "@/lib/rewards.server";
import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext, resolveAppId } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/rewards/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const url = new URL(request.url);
        const appId = await resolveAppId(request, url, { required: true });

        const capabilityKeys = new Set(
          await getApplicationCapabilities({ data: { appId: appId! } }),
        );
        if (!capabilityKeys.has("rewards")) {
          throw new ApiError("CAPABILITY_DISABLED", "Rewards is not enabled for this application.");
        }

        await promotePendingReferralVerifications(ctx.userId);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const [{ data: ledgerRows }, { data: redemptionRows }] = await Promise.all([
          supabaseAdmin.from("reward_ledger").select("points").eq("user_id", ctx.userId),
          supabaseAdmin.from("reward_redemptions").select("points_spent").eq("user_id", ctx.userId),
        ]);
        const lifetimePoints = (ledgerRows ?? []).reduce((sum, r) => sum + r.points, 0);
        const redeemedPoints = (redemptionRows ?? []).reduce((sum, r) => sum + r.points_spent, 0);
        const rewardPoints = lifetimePoints - redeemedPoints;

        const [
          { data: levels },
          { data: achievementRows },
          { data: catalogRows },
          { count: verifiedReferrals },
          { data: redemptions },
        ] = await Promise.all([
          supabaseAdmin
            .from("reward_levels")
            .select("*")
            .eq("enabled", true)
            .eq("archived", false)
            .lte("min_lifetime_points", lifetimePoints)
            .order("min_lifetime_points", { ascending: false })
            .limit(1),
          supabaseAdmin
            .from("user_achievements")
            .select("achievement_key, earned_at, reward_achievements(label, description)")
            .eq("user_id", ctx.userId)
            .order("earned_at", { ascending: false }),
          supabaseAdmin
            .from("reward_catalog")
            .select("*")
            .eq("enabled", true)
            .eq("archived", false)
            .order("display_order", { ascending: true }),
          supabaseAdmin
            .from("premium_referrals")
            .select("id", { count: "exact", head: true })
            .eq("referrer_id", ctx.userId)
            .not("verified_at", "is", null),
          supabaseAdmin
            .from("reward_redemptions")
            .select("*")
            .eq("user_id", ctx.userId)
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

        const verifiedReferralsCount = verifiedReferrals ?? 0;
        const visibleCatalogRows = (catalogRows ?? []).filter(
          (c) => !c.requires_capability || capabilityKeys.has(c.requires_capability),
        );

        return apiData({
          rewardPoints,
          lifetimePoints,
          level: levels?.[0]
            ? { key: levels[0].key, label: levels[0].label }
            : { key: "member", label: "Member" },
          verifiedReferrals: verifiedReferralsCount,
          achievements: (achievementRows ?? []).map((a) => ({
            key: a.achievement_key,
            label: a.reward_achievements?.label ?? a.achievement_key,
            earnedAt: a.earned_at,
          })),
          catalog: visibleCatalogRows.map((c) => ({
            key: c.key,
            label: c.label,
            pointsCost: c.points_cost,
            verifiedReferralsRequired: c.verified_referrals_required,
            canRedeem:
              rewardPoints >= c.points_cost &&
              verifiedReferralsCount >= c.verified_referrals_required,
          })),
          redeemHistory: (redemptions ?? []).map((r) => ({
            catalogKey: r.catalog_key,
            pointsSpent: r.points_spent,
            status: (r.grant_result as { status?: string } | null)?.status ?? "pending_fulfillment",
            redeemedAt: r.created_at,
          })),
        });
      }),
    },
  },
});
