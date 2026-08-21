// CORE User Engagement & Dashboard Actions -- a compact "Recent Activity"
// panel on the central Dashboard. Pure reuse of the existing Cross-App
// User Activity Dashboard (Priority 15 Phase E): getMyActivityDashboard()
// already computes a per-user recentActivity feed from reward_ledger
// (meaningful, points>0 rows only -- never a page-view/click log, spec
// section 14) -- this component adds no new backend, it only renders a
// short slice of that same, already-correct data. The full view remains
// /dashboard/activity; this is a preview, not a duplicate.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Activity, ChevronRight } from "lucide-react";

import { getMyActivityDashboard } from "@/lib/activity-dashboard.functions";

const VISIBLE_LIMIT = 5;

export function RecentActivity({ userId }: { userId?: string }) {
  const { t, i18n } = useTranslation();
  const fn = useServerFn(getMyActivityDashboard);
  const query = useQuery({
    queryKey: ["dashboard", "recent-activity", userId],
    enabled: !!userId,
    queryFn: () => fn(),
  });

  const recent = (query.data?.recentActivity ?? []).slice(0, VISIBLE_LIMIT);
  // Nothing to show for a brand-new user with no ledger activity yet --
  // renders nothing rather than an empty panel.
  if (!query.isLoading && recent.length === 0) return null;

  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Activity className="h-4 w-4 text-[#1D6BF3]" />
          {t("dashboardActions.recentActivity")}
        </h3>
        <Link
          to="/dashboard/activity"
          className="text-xs font-medium text-[#1D6BF3] hover:underline"
        >
          {t("dashboard.viewAll")}
        </Link>
      </div>
      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 w-full animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {recent.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{r.action}</p>
                <p className="truncate text-xs text-gray-400">
                  {r.appName === "core" ? t("dashboardActions.core") : r.appName} ·{" "}
                  {new Date(r.createdAt).toLocaleDateString(i18n.language)}
                </p>
              </div>
              {r.points > 0 && (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  +{r.points}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Link
        to="/dashboard/activity"
        className="mt-3 flex items-center justify-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900"
      >
        {t("dashboard.viewAll")}
        <ChevronRight className="h-3 w-3" />
      </Link>
    </section>
  );
}
