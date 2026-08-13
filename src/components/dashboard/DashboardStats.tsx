// Priority 17: Profile + Points + Activity header stats. Reuses the
// EXISTING getMyActivityDashboard() (lifetimePoints/level) -- no new
// points calculation, no new level resolver.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Trophy, Flame } from "lucide-react";

import { getMyActivityDashboard } from "@/lib/activity-dashboard.functions";
import { Skeleton } from "@/components/ui/skeleton";

export function DashboardStats({ userId }: { userId?: string }) {
  const { t } = useTranslation();
  const getActivityFn = useServerFn(getMyActivityDashboard);

  const query = useQuery({
    queryKey: ["dashboard", "activity-stats", userId],
    enabled: !!userId,
    queryFn: () => getActivityFn(),
  });

  const points = query.data?.lifetimePoints ?? 0;
  const levelLabel = query.data?.level?.label ?? null;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
          <Trophy className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          {query.isLoading ? (
            <Skeleton className="h-6 w-16" />
          ) : (
            <p className="truncate text-lg font-bold text-gray-900">
              {points.toLocaleString()}
            </p>
          )}
          <p className="truncate text-xs text-gray-500">{t("dashboard.stats.points")}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
          <Flame className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          {query.isLoading ? (
            <Skeleton className="h-6 w-16" />
          ) : (
            <p className="truncate text-lg font-bold text-gray-900">
              {levelLabel ?? t("dashboard.stats.noLevel")}
            </p>
          )}
          <p className="truncate text-xs text-gray-500">{t("dashboard.stats.activity")}</p>
        </div>
      </div>
    </div>
  );
}
