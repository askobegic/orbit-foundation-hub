// Priority 15 Phase E (15.14): Cross-App User Activity Dashboard --
// aggregates existing data (reward_ledger, levels, streaks, missions/
// challenges, entitlements); creates no new activity storage. Reuses
// existing Dashboard design patterns; does not touch /dashboard/rewards
// or any other existing section.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Activity, Flame, Gift, Target, Trophy } from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Skeleton } from "@/components/ui/skeleton";
import { getMyActivityDashboard } from "@/lib/activity-dashboard.functions";

export const Route = createFileRoute("/dashboard/activity")({
  head: () => ({
    meta: [
      { title: "My Activity — Core Platform" },
      { name: "description", content: "Your cross-app activity, points, streaks, and benefits." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <ActivityPage />
    </ProtectedRoute>
  ),
});

function pickLocalized(
  row: { nameBs: string; nameEn: string; nameDe: string },
  language: string,
): string {
  if (language.startsWith("bs")) return row.nameBs;
  if (language.startsWith("de")) return row.nameDe;
  return row.nameEn;
}

function ActivityPage() {
  const { t, i18n } = useTranslation();
  const fn = useServerFn(getMyActivityDashboard);
  const query = useQuery({ queryKey: ["activity-dashboard", "me"], queryFn: () => fn() });
  const data = query.data;

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("auth.backToDashboard")}
        </Link>

        <header className="mt-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1D6BF3]/10 text-[#1D6BF3]">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("activity.title")}</h1>
            <p className="text-sm text-gray-500">{t("activity.subtitle")}</p>
          </div>
        </header>

        {query.isLoading ? (
          <div className="mt-6 space-y-4">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : data ? (
          <>
            {/* Per-app breakdown + total -- the headline "MOJA AKTIVNOST" view */}
            <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">{t("activity.byApp")}</h2>
              {data.byApp.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t("activity.noActivity")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-100">
                  {data.byApp.map((a) => (
                    <li
                      key={a.appId ?? "core"}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span>{a.appId === null ? t("rewards.pointsByAppCore") : a.appName}</span>
                      <span className="font-medium">{a.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-sm font-semibold">
                <span>{t("activity.total")}</span>
                <span>{data.totalActivity}</span>
              </div>
            </section>

            {/* Summary stat tiles */}
            <section className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-gray-100">
                <p className="text-2xl font-semibold text-[#1D6BF3]">{data.lifetimePoints}</p>
                <p className="mt-1 text-xs text-gray-500">{t("rewards.lifetimePoints")}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-gray-100">
                <p className="flex items-center justify-center gap-1 text-lg font-semibold">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  {data.level?.label ?? "—"}
                </p>
                <p className="mt-1 text-xs text-gray-500">{t("rewards.level")}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-gray-100">
                <p className="flex items-center justify-center gap-1 text-lg font-semibold">
                  <Target className="h-4 w-4 text-[#1D6BF3]" />
                  {data.missions.completed}/{data.missions.active}
                </p>
                <p className="mt-1 text-xs text-gray-500">{t("activity.missions")}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-gray-100">
                <p className="flex items-center justify-center gap-1 text-lg font-semibold">
                  <Trophy className="h-4 w-4 text-[#1D6BF3]" />
                  {data.challenges.completed}/{data.challenges.active}
                </p>
                <p className="mt-1 text-xs text-gray-500">{t("activity.challenges")}</p>
              </div>
            </section>

            {data.streaks.length > 0 && (
              <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Flame className="h-4 w-4 text-orange-500" />
                  {t("activity.streaks")}
                </h2>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {data.streaks.map((s) => (
                    <li
                      key={s.key}
                      className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-sm"
                    >
                      <span className="font-medium text-gray-800">
                        {pickLocalized(s, i18n.language)}
                      </span>
                      <span className="ml-2 text-orange-600">{s.currentStreak}d</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.activeEntitlements.length > 0 && (
              <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Gift className="h-4 w-4 text-emerald-500" />
                  {t("activity.activeBenefits")}
                </h2>
                <ul className="mt-3 divide-y divide-gray-100">
                  {data.activeEntitlements.map((e, i) => (
                    <li key={i} className="flex items-center justify-between py-2 text-sm">
                      <span>
                        {e.benefitType} {e.appName ? `· ${e.appName}` : ""}
                      </span>
                      <span className="text-xs text-gray-500">
                        {e.endsAt
                          ? new Date(e.endsAt).toLocaleDateString(i18n.language)
                          : t("activity.noExpiry")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">{t("activity.recent")}</h2>
              {data.recentActivity.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t("activity.noActivity")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-100">
                  {data.recentActivity.map((r, i) => (
                    <li key={i} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <p className="font-medium text-gray-800">{r.action}</p>
                        <p className="text-xs text-gray-500">
                          {r.appName === "core" ? t("rewards.pointsByAppCore") : r.appName} ·{" "}
                          {new Date(r.createdAt).toLocaleString(i18n.language)}
                        </p>
                      </div>
                      <span className="font-medium text-[#1D6BF3]">+{r.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
