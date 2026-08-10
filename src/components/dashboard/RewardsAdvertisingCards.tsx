import { Link } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Gift, Megaphone } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useApplication } from "@/context/ApplicationContext";
import { getRewardsMe } from "@/lib/rewards.functions";
import { getMyCampaigns } from "@/lib/advertising.functions";
import { Skeleton } from "@/components/ui/skeleton";

type RewardsData = Awaited<ReturnType<typeof getRewardsMe>>;
type CampaignsData = Awaited<ReturnType<typeof getMyCampaigns>>;

// Rewards and Advertising are permanently visible CORE Dashboard features
// (explicit product decision -- not tied to the rewards/advertising
// capability, any dashboard widget setting, or either query's own
// state). This is the only component on the Dashboard that renders
// them, and it does so unconditionally: no prop controls whether
// <RewardsCard>/<AdvertisingCard> render, no state here is ever used to
// hide the <section> or either card, and neither card's JSX has any
// wrapping condition -- only their internal content (points/campaign
// numbers, or a loading skeleton) varies. A failed or empty query
// resolves to the same safe zero/empty-state content a successful-but-
// empty one would, never to an absent card. Deliberately bypasses the
// Dashboard Widget Modularity mechanism (isWidgetEnabled/widgetsQuery)
// every other Dashboard section uses -- see PROJECT_KNOWLEDGE.md for
// why that mechanism exists elsewhere; it does not apply to these two
// cards.
export function RewardsAdvertisingCards() {
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

  return (
    <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <RewardsCard query={rewardsQuery} />
      <AdvertisingCard query={campaignsQuery} />
    </section>
  );
}

function RewardsCard({ query }: { query: UseQueryResult<RewardsData> }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Gift className="h-4 w-4 text-[#1D6BF3]" />
          {t("nav.rewards")}
        </h3>
        <Link
          to="/dashboard/rewards"
          className="text-xs font-medium text-[#1D6BF3] hover:underline"
        >
          {t("dashboard.viewRewards")}
        </Link>
      </div>
      {query.isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold text-gray-900">
              {query.data?.lifetimePoints ?? 0}
            </p>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
              {query.data?.level?.label ?? t("dashboard.standard")}
            </span>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {(query.data?.redeemHistory?.length ?? 0) > 0
              ? t("dashboard.recentActivityCount", {
                  count: query.data!.redeemHistory.length,
                })
              : t("dashboard.noRecentActivity")}
          </p>
        </>
      )}
    </div>
  );
}

function AdvertisingCard({ query }: { query: UseQueryResult<CampaignsData> }) {
  const { t } = useTranslation();
  const activeCount = (query.data ?? []).filter((c) => c.status === "active").length;
  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Megaphone className="h-4 w-4 text-[#1D6BF3]" />
          {t("nav.advertising")}
        </h3>
        <Link
          to="/dashboard/advertising"
          className="text-xs font-medium text-[#1D6BF3] hover:underline"
        >
          {t("dashboard.manageAdvertising")}
        </Link>
      </div>
      {query.isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold text-gray-900">{activeCount}</p>
            <span className="text-xs text-gray-500">
              {t("dashboard.ofTotalCampaigns", { count: query.data?.length ?? 0 })}
            </span>
          </div>
          {(query.data?.length ?? 0) === 0 && (
            <p className="mt-2 text-xs text-gray-500">{t("dashboard.noCampaignsYet")}</p>
          )}
        </>
      )}
    </div>
  );
}
