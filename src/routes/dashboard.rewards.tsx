import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Flame, Gift, Target, Trophy, Star, Users } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardMobileNav } from "@/components/dashboard/DashboardNav";
import { Skeleton } from "@/components/ui/skeleton";
import { useApplication } from "@/context/ApplicationContext";
import { getRewardsMe, redeemReward } from "@/lib/rewards.functions";
import { getMyEngagement } from "@/lib/engagement.functions";

export const Route = createFileRoute("/dashboard/rewards")({
  head: () => ({
    meta: [
      { title: "Rewards & Loyalty — Core Platform" },
      { name: "description", content: "Track points, levels, achievements, and redeem rewards." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <RewardsPage />
    </ProtectedRoute>
  ),
});

// Admin-authored trilingual content (engagement_definitions/streak_definitions
// name_bs/en/de) -- picked client-side by current UI language, the same
// convention notifications already uses for its own trilingual columns.
function pickLocalized(
  row: { nameBs: string; nameEn: string; nameDe: string },
  language: string,
): string {
  if (language.startsWith("bs")) return row.nameBs;
  if (language.startsWith("de")) return row.nameDe;
  return row.nameEn;
}

const LEVEL_I18N_KEY: Record<string, string> = {
  member: "rewards.levelMember",
  bronze: "rewards.levelBronze",
  silver: "rewards.levelSilver",
  gold: "rewards.levelGold",
  platinum: "rewards.levelPlatinum",
  ambassador: "rewards.levelAmbassador",
  legend: "rewards.levelLegend",
};

function RewardsPage() {
  const { t, i18n } = useTranslation();
  const { application } = useApplication();
  const queryClient = useQueryClient();
  const getRewardsMeFn = useServerFn(getRewardsMe);
  const redeemRewardFn = useServerFn(redeemReward);

  // appId is passed when resolved so capability-gated catalog items (see
  // reward_catalog.requiresCapability) are filtered correctly; omitted
  // entirely otherwise rather than blocking the page on it.
  const rewardsQuery = useQuery({
    queryKey: ["rewards", "me", application?.id],
    queryFn: () => getRewardsMeFn({ data: { appId: application?.id } }),
  });

  const getMyEngagementFn = useServerFn(getMyEngagement);
  const engagementQuery = useQuery({
    queryKey: ["engagement", "me", application?.id],
    queryFn: () => getMyEngagementFn({ data: { appId: application?.id ?? null } }),
  });

  async function handleRedeem(catalogKey: string) {
    try {
      await redeemRewardFn({ data: { catalogKey, appId: application?.id } });
      toast.success(t("rewards.redeemSuccess"));
      await queryClient.invalidateQueries({ queryKey: ["rewards", "me"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("rewards.redeemError"));
    }
  }

  const data = rewardsQuery.data;
  const levelLabel = data ? t(LEVEL_I18N_KEY[data.level.key] ?? data.level.label) : "";

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
          <DashboardMobileNav />
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1D6BF3]/10 text-[#1D6BF3]">
            <Gift className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("rewards.title")}</h1>
            <p className="text-sm text-gray-500">{t("rewards.subtitle")}</p>
          </div>
        </header>

        {rewardsQuery.isLoading ? (
          <div className="mt-6 space-y-4">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : data ? (
          <>
            <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-gray-100">
                <p className="text-2xl font-semibold text-[#1D6BF3]">{data.rewardPoints}</p>
                <p className="mt-1 text-xs text-gray-500">{t("rewards.rewardPoints")}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-gray-100">
                <p className="text-2xl font-semibold">{data.lifetimePoints}</p>
                <p className="mt-1 text-xs text-gray-500">{t("rewards.lifetimePoints")}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-gray-100">
                <p className="flex items-center justify-center gap-1 text-lg font-semibold">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  {levelLabel}
                </p>
                <p className="mt-1 text-xs text-gray-500">{t("rewards.level")}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-gray-100">
                <p className="flex items-center justify-center gap-1 text-2xl font-semibold">
                  <Users className="h-4 w-4 text-emerald-500" />
                  {data.verifiedReferrals}
                </p>
                <p className="mt-1 text-xs text-gray-500">{t("rewards.verifiedReferrals")}</p>
              </div>
            </section>

            {data.pointsByApp.length > 1 && (
              <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
                <p className="mb-2 text-xs font-semibold uppercase text-gray-500">
                  {t("rewards.pointsByApp")}
                </p>
                <ul className="divide-y divide-gray-100">
                  {data.pointsByApp.map((a) => (
                    <li
                      key={a.appId ?? "core"}
                      className="flex items-center justify-between py-1.5 text-sm"
                    >
                      <span>{a.appName === "core" ? t("rewards.pointsByAppCore") : a.appName}</span>
                      <span className="font-medium">{a.points}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Star className="h-4 w-4 text-amber-500" />
                {t("rewards.achievements")}
              </h2>
              {data.achievements.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t("rewards.noAchievements")}</p>
              ) : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {data.achievements.map((a) => (
                    <li
                      key={a.key}
                      className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-sm"
                    >
                      <p className="font-medium text-gray-800">{a.label}</p>
                      {a.description && (
                        <p className="mt-0.5 text-xs text-gray-500">{a.description}</p>
                      )}
                      <p className="mt-1 text-[11px] text-gray-400">
                        {new Date(a.earnedAt).toLocaleDateString(i18n.language)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">
                {t("rewards.availableRewards")}
              </h2>
              {data.catalog.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t("rewards.noRewards")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-100">
                  {data.catalog.map((c) => (
                    <li key={c.key} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">{c.label}</p>
                        {c.description && <p className="text-xs text-gray-500">{c.description}</p>}
                        <p className="mt-0.5 text-xs text-gray-400">
                          {t("rewards.pointsCost", { points: c.pointsCost })}
                          {c.verifiedReferralsRequired > 0 &&
                            ` · ${t("rewards.referralsRequired", { count: c.verifiedReferralsRequired })}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={!c.canRedeem}
                        onClick={() => void handleRedeem(c.key)}
                        className="shrink-0 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#155ac9] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t("rewards.redeem")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">{t("rewards.redeemHistory")}</h2>
              {data.redeemHistory.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t("rewards.noRedeemHistory")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-100">
                  {data.redeemHistory.map((r, i) => (
                    <li key={i} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <p className="font-medium text-gray-800">{r.catalogKey}</p>
                        <p className="text-xs text-gray-500">
                          {new Date(r.redeemedAt).toLocaleDateString(i18n.language)}
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        {t("rewards.statusPending")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Target className="h-4 w-4 text-[#1D6BF3]" />
                {t("rewards.missionsTitle")}
              </h2>
              {(engagementQuery.data?.missions.length ?? 0) === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t("rewards.noMissions")}</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {engagementQuery.data!.missions.map((m) => (
                    <EngagementRow key={m.id} item={m} language={i18n.language} />
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Trophy className="h-4 w-4 text-[#1D6BF3]" />
                {t("rewards.challengesTitle")}
              </h2>
              {(engagementQuery.data?.challenges.length ?? 0) === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t("rewards.noChallenges")}</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {engagementQuery.data!.challenges.map((c) => (
                    <EngagementRow key={c.id} item={c} language={i18n.language} />
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Flame className="h-4 w-4 text-orange-500" />
                {t("rewards.streaksTitle")}
              </h2>
              {(engagementQuery.data?.streaks.length ?? 0) === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t("rewards.noStreaks")}</p>
              ) : (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {engagementQuery.data!.streaks.map((s) => (
                    <li key={s.id} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                      <p className="text-sm font-medium text-gray-800">{pickLocalized(s, i18n.language)}</p>
                      <p className="mt-1 flex items-center gap-1 text-xl font-semibold text-orange-600">
                        <Flame className="h-4 w-4" />
                        {t("rewards.streakDays", { count: s.currentStreak })}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t("rewards.streakLongest", { count: s.longestStreak })}
                      </p>
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

type EngagementItem = {
  id: string;
  nameBs: string;
  nameEn: string;
  nameDe: string;
  descriptionBs: string | null;
  descriptionEn: string | null;
  descriptionDe: string | null;
  rewardPoints: number;
  completed: boolean;
  conditions: { eventKey: string; target: number; count: number }[];
};

function EngagementRow({ item, language }: { item: EngagementItem; language: string }) {
  const { t } = useTranslation();
  const description =
    language.startsWith("bs")
      ? item.descriptionBs
      : language.startsWith("de")
        ? item.descriptionDe
        : item.descriptionEn;
  const totalTarget = item.conditions.reduce((sum, c) => sum + c.target, 0) || 1;
  const totalCount = item.conditions.reduce((sum, c) => sum + c.count, 0);
  const pct = Math.round((Math.min(totalCount, totalTarget) / totalTarget) * 100);

  return (
    <li className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">{pickLocalized(item, language)}</p>
          {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
        </div>
        {item.completed ? (
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            {t("rewards.completed")}
          </span>
        ) : (
          <span className="shrink-0 text-xs font-medium text-gray-500">
            {t("rewards.pointsCost", { points: item.rewardPoints })}
          </span>
        )}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full ${item.completed ? "bg-emerald-500" : "bg-[#1D6BF3]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        {t("rewards.progress", { count: Math.min(totalCount, totalTarget), total: totalTarget })}
      </p>
    </li>
  );
}
