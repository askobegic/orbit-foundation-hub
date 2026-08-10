import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ChevronRight, Gift, Megaphone } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useApplication } from "@/context/ApplicationContext";
import { getRewardsMe } from "@/lib/rewards.functions";
import { getMyCampaigns } from "@/lib/advertising.functions";
import { Skeleton } from "@/components/ui/skeleton";

// Rewards and Advertising are permanently visible CORE Dashboard features
// (explicit product decision, not tied to the rewards/advertising
// capability or any dashboard widget setting) -- pulled into their own
// component, deliberately bypassing the Dashboard Widget Modularity
// mechanism (isWidgetEnabled/widgetsQuery) every other section on
// DashboardPage uses, so their visibility can never be made conditional
// again by an edit to this file alone: there is no prop, no wrapping
// condition, and no dependency on application/widget state anywhere in
// this component or at its one call site in DashboardPage.tsx. Self
// contained on purpose, matching DashboardMobileNav's own pattern -- it
// fetches its own data via the same aggregate server functions the
// dedicated /dashboard/rewards and /dashboard/advertising pages already
// call, rather than receiving query results as props.
//
// Only each card's CONTENT reacts to loading/error/empty data (a
// skeleton while loading, the existing zero/empty-state text once
// settled, including on error, since a failed query leaves `data`
// undefined and every read below falls back to a safe default) -- the
// two <Link> elements themselves are unconditional children of this
// component's return value, full stop.
export function RewardsAdvertisingCards() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { application } = useApplication();
  const getRewardsMeFn = useServerFn(getRewardsMe);
  const getMyCampaignsFn = useServerFn(getMyCampaigns);

  const rewardsQuery = useQuery({
    queryKey: ["rewards", "me", application?.id],
    enabled: !!user?.id,
    queryFn: () => getRewardsMeFn({ data: { appId: application?.id } }),
  });
  const campaignsQuery = useQuery({
    queryKey: ["dashboard", "campaigns", user?.id],
    enabled: !!user?.id,
    queryFn: () => getMyCampaignsFn(),
  });
  const activeCampaignCount = (campaignsQuery.data ?? []).filter(
    (c) => c.status === "active",
  ).length;

  return (
    <>
      <Link
        to="/dashboard/rewards"
        className="block rounded-xl border border-gray-100 p-3 transition hover:border-gray-200 hover:bg-gray-50"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <Gift className="h-3.5 w-3.5 text-[#1D6BF3]" />
            {t("dashboard.rewardsPoints")}
          </span>
          <ChevronRight className="h-3 w-3 shrink-0 text-gray-400" />
        </div>
        {rewardsQuery.isLoading ? (
          <Skeleton className="mt-2 h-6 w-16" />
        ) : (
          <>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <p className="text-xl font-semibold text-gray-900">
                {rewardsQuery.data?.lifetimePoints ?? 0}
              </p>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                {rewardsQuery.data?.level?.label ?? t("dashboard.standard")}
              </span>
            </div>
            <p className="mt-2 truncate text-[11px] text-gray-500">
              {(rewardsQuery.data?.redeemHistory?.length ?? 0) > 0
                ? t("dashboard.recentActivityCount", {
                    count: rewardsQuery.data!.redeemHistory.length,
                  })
                : t("dashboard.noRecentActivity")}
            </p>
          </>
        )}
      </Link>

      <Link
        to="/dashboard/advertising"
        className="block rounded-xl border border-gray-100 p-3 transition hover:border-gray-200 hover:bg-gray-50"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <Megaphone className="h-3.5 w-3.5 text-[#1D6BF3]" />
            {t("dashboard.campaigns")}
          </span>
          <ChevronRight className="h-3 w-3 shrink-0 text-gray-400" />
        </div>
        {campaignsQuery.isLoading ? (
          <Skeleton className="mt-2 h-6 w-16" />
        ) : (
          <>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <p className="text-xl font-semibold text-gray-900">{activeCampaignCount}</p>
              <span className="shrink-0 text-[11px] text-gray-500">
                {t("dashboard.ofTotalCampaigns", {
                  count: campaignsQuery.data?.length ?? 0,
                })}
              </span>
            </div>
            {(campaignsQuery.data?.length ?? 0) === 0 && (
              <p className="mt-2 text-[11px] text-gray-500">{t("dashboard.noCampaignsYet")}</p>
            )}
          </>
        )}
      </Link>
    </>
  );
}
