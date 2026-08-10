import { ShareAndInvite } from "@/components/dashboard/ShareAndInvite";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { NotificationBell } from "@/components/dashboard/NotificationBell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  User,
  Settings,
  Shield,
  HelpCircle,
  LogOut,
  Crown,
  MapPin,
  ExternalLink,
  ChevronRight,
  Lock,
  BadgeCheck,
  Gift,
  Megaphone,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useApplication } from "@/context/ApplicationContext";
import { supabase } from "@/integrations/supabase/client";
import { hasAnyActivePremium } from "@/lib/premium";
import { getDashboardWidgets } from "@/lib/dashboard-widgets.functions";
import { RewardsAdvertisingCards } from "@/components/dashboard/RewardsAdvertisingCards";
import { DashboardMobileNav } from "@/components/dashboard/DashboardNav";
import { getDashboardNavItems } from "@/lib/dashboard-nav";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { Skeleton } from "@/components/ui/skeleton";
import { TrialBanner } from "@/components/dashboard/TrialBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import type {
  ApplicationRow,
  PaymentRow,
  SubscriptionRow,
  SubscriptionPlanRow,
} from "@/types/database";

type SubscriptionWithPlan = SubscriptionRow & { plan: SubscriptionPlanRow | null };

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { user, profile, signOut } = useAuth();
  const { application } = useApplication();
  const lang = (i18n.language?.slice(0, 2) ?? "bs") as "bs" | "en" | "de";
  const getDashboardWidgetsFn = useServerFn(getDashboardWidgets);

  // Priority 8.2: Dashboard Widget Modularity -- which of this page's
  // sections are enabled, globally or overridden for the application
  // currently being browsed (see PROJECT_KNOWLEDGE.md -> Dashboard Widget
  // Modularity). Defaults to "all enabled" while loading/unresolved rather
  // than flashing an empty dashboard.
  const widgetsQuery = useQuery({
    queryKey: ["dashboard-widgets", application?.id],
    enabled: !!application?.id,
    queryFn: () => getDashboardWidgetsFn({ data: { appId: application!.id } }),
  });
  const isWidgetEnabled = (key: string) =>
    !application || (widgetsQuery.data?.includes(key) ?? true);
  const rewardsEnabled = isWidgetEnabled("rewards");
  const advertisingEnabled = isWidgetEnabled("advertising");
  const messagingEnabled = isWidgetEnabled("messaging");

  // Priority 8.9: Application Visibility -- draft and archived are hidden
  // from every normal user (draft: not ready yet, admin-only; archived:
  // retired, preserved for history/administration only), excluded at the
  // query itself rather than merely not-rendered, so a end-user's own
  // dashboard never even receives those rows. coming_soon/active are the
  // only two states a normal user's Dashboard ever shows.
  const appsQuery = useQuery({
    queryKey: ["dashboard", "applications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .in("visibility", ["coming_soon", "active"])
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ApplicationRow[];
    },
  });

  const subsQuery = useQuery({
    queryKey: ["dashboard", "subscriptions", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*, plan:subscription_plans(*)")
        .eq("user_id", user!.id)
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString());
      if (error) throw error;
      return (data ?? []) as unknown as SubscriptionWithPlan[];
    },
  });

  const paymentsQuery = useQuery({
    queryKey: ["dashboard", "payments", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return (data ?? []) as PaymentRow[];
    },
  });

  const notificationsQuery = useQuery({
    queryKey: ["dashboard", "notifications", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("is_read", false);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Global Premium Visibility & Contact System: the one shared "is this
  // user Premium" check, same as every other surface (Profile Card,
  // dashboard.profile.tsx) -- not re-derived from subsQuery, and not
  // profiles.user_type (a stored flag that doesn't reflect real-time
  // subscription state). Premium is ecosystem-wide, so this single value
  // applies uniformly to every "My Applications" tile below -- there is no
  // per-application Premium/Standard distinction anymore.
  const hasPremiumQuery = useQuery({
    queryKey: ["premium", "hasAny", user?.id],
    queryFn: () => hasAnyActivePremium(user!.id),
    enabled: !!user?.id,
  });
  const hasPremium = hasPremiumQuery.data ?? false;
  // Per-app expiry/plan display remains a legitimate billing-record concern
  // (which application's plan is expiring when), independent of the global
  // Premium permission above.
  const premiumExpiryByApp = useMemo(() => {
    const map = new Map<string, string>();
    (subsQuery.data ?? []).forEach((s) => {
      if (s.app_id && s.expires_at) map.set(s.app_id, s.expires_at);
    });
    return map;
  }, [subsQuery.data]);
  const activeSub = subsQuery.data?.[0] ?? null;

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const initials =
    (profile?.first_name?.[0] ?? "") + (profile?.last_name?.[0] ?? "") || (user?.email?.[0] ?? "?");

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-gray-900">
      <Sidebar
        onSignOut={() => void signOut()}
        rewardsEnabled={rewardsEnabled}
        advertisingEnabled={advertisingEnabled}
        messagingEnabled={messagingEnabled}
      />

      <div className="lg:pl-64">
        <InstallPrompt />
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-gray-100 bg-white/80 px-4 backdrop-blur lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <DashboardMobileNav />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">
                {t("dashboard.welcome")}
                {profile?.first_name ? `, ${profile.first_name}` : ""} 👋
              </h1>
              <p className="hidden truncate text-xs text-gray-500 sm:block">
                {t("dashboard.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <LanguageSwitcher />
            <NotificationBell />
            <div className="flex min-w-0 items-center gap-2 rounded-full border border-gray-200 bg-white py-1 pl-1 pr-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#1D6BF3] to-[#6366F1] text-xs font-semibold text-white">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials.toUpperCase()
                )}
              </span>
              <span className="hidden min-w-0 max-w-[160px] truncate text-sm font-medium sm:inline">
                {fullName || user?.email}
              </span>
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 gap-6 overflow-x-hidden p-4 lg:grid-cols-3 lg:p-8">
          {/* Rewards / Advertising: permanently visible CORE Dashboard
              features, rendered unconditionally at the very top so they're
              visible immediately on page load -- see
              RewardsAdvertisingCards.tsx for why this bypasses every other
              gating mechanism on this page. */}
          <div className="lg:col-span-3">
            <RewardsAdvertisingCards />
          </div>

          {/* LEFT (2 cols) */}
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
            {isWidgetEnabled("trial_banner") && <TrialBanner />}
            {/* Profile card */}
            <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              <div className="h-24 bg-gradient-to-r from-[#1D6BF3] via-[#6366F1] to-[#8B5CF6]" />
              <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex min-w-0 items-end gap-4">
                  <div className="-mt-14 h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-gray-100 shadow-sm">
                    {profile?.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={fullName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-gray-500">
                        {initials.toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="min-w-0 truncate text-lg font-semibold">
                        {fullName || user?.email || t("profile.notEntered")}
                      </h2>
                      {profile?.is_verified && (
                        <BadgeCheck
                          className="h-4 w-4 shrink-0 text-[#1D6BF3]"
                          aria-label={t("profile.verified")}
                        />
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {profile?.city ? (
                          <>
                            {profile.city}
                            {profile.country ? `, ${profile.country}` : ""}
                          </>
                        ) : (
                          <span className="text-gray-400">{t("profile.notEntered")}</span>
                        )}
                      </span>
                      {profile?.created_at && (
                        <span>
                          {t("profile.memberSince")}{" "}
                          {new Date(profile.created_at).toLocaleDateString(i18n.language)}
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                          hasPremium
                            ? "bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {hasPremium ? (
                          <>
                            <Crown className="h-3 w-3" /> {t("dashboard.premium")}
                          </>
                        ) : (
                          t("dashboard.standard")
                        )}
                      </span>
                    </div>
                  </div>
                </div>
                <Link
                  to="/dashboard/profile"
                  className="inline-flex items-center justify-center rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1858cf]"
                >
                  {t("dashboard.editProfile")}
                </Link>
              </div>
            </section>

            {/* Applications */}
            {isWidgetEnabled("my_applications") && (
              <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-base font-semibold">{t("dashboard.myApps")}</h3>
                  <span className="text-xs text-gray-400">{appsQuery.data?.length ?? 0}</span>
                </div>
                {appsQuery.isLoading ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-20 w-full rounded-xl" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(appsQuery.data ?? []).map((app) => {
                      // Premium is global (see hasPremium above) -- every
                      // tile reflects the same platform-wide status, not a
                      // per-application one.
                      const isPremium = hasPremium;
                      const isActive = app.visibility === "active";
                      const desc =
                        app[`short_description_${lang}` as const] ?? app.short_description_en ?? "";
                      const expiry = premiumExpiryByApp.get(app.id);
                      if (!isActive) {
                        return (
                          <div
                            key={app.id}
                            className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/40 p-3 opacity-60"
                          >
                            {app.logo_url ? (
                              <img
                                src={app.logo_url}
                                alt={app.name}
                                width={44}
                                height={44}
                                className="h-11 w-11 shrink-0 rounded-xl object-cover grayscale"
                              />
                            ) : (
                              <div
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white grayscale"
                                style={{ backgroundColor: app.primary_color }}
                              >
                                {app.name.slice(0, 1)}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 truncate text-sm font-medium text-gray-500">
                                  {app.name}
                                </span>
                                <span className="shrink-0 rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                                  {t("dashboard.comingSoon")}
                                </span>
                              </div>
                              <p className="truncate text-xs text-gray-400">
                                {app.launch_date
                                  ? `${t("dashboard.launchDate")}: ${new Date(app.launch_date).toLocaleDateString(i18n.language)}`
                                  : desc}
                              </p>
                            </div>
                          </div>
                        );
                      }
                      // Shared between both layouts below -- identical markup,
                      // computed once so the two layouts can never drift apart
                      // on how the avatar itself renders.
                      const avatar = app.logo_url ? (
                        <img
                          src={app.logo_url}
                          alt={app.name}
                          width={44}
                          height={44}
                          className={`h-11 w-11 shrink-0 rounded-xl object-cover ${
                            isPremium ? "" : "grayscale opacity-70"
                          }`}
                        />
                      ) : (
                        <div
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white ${
                            isPremium ? "" : "grayscale opacity-70"
                          }`}
                          style={{ backgroundColor: app.primary_color }}
                        >
                          {app.name.slice(0, 1)}
                        </div>
                      );
                      const badge = (
                        <span
                          className={`w-fit shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            isPremium
                              ? "bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-white"
                              : "bg-gray-200 text-gray-500"
                          }`}
                        >
                          {isPremium ? t("dashboard.premium") : t("dashboard.standard")}
                        </span>
                      );
                      const descriptionText =
                        isPremium && expiry
                          ? `${t("dashboard.validUntil")}: ${new Date(expiry).toLocaleDateString(i18n.language)}`
                          : desc;
                      const upgradeLink = !isPremium && (
                        <Link
                          to="/pricing"
                          search={{ app: app.slug }}
                          className="rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                        >
                          {t("dashboard.upgrade")}
                        </Link>
                      );
                      const externalLink = app.domain && (
                        <a
                          href={`https://${app.domain}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={t("dashboard.openApp")}
                          className={`shrink-0 rounded-lg p-2 hover:bg-gray-50 ${
                            isPremium
                              ? "text-[#1D6BF3] hover:text-[#1858cf]"
                              : "text-gray-300 hover:text-gray-500"
                          }`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      );

                      return (
                        // Unstyled wrapper carrying only the list key and
                        // the grid-item min-width override (this grid uses
                        // Tailwind's grid-cols-N, i.e. minmax(0,1fr) tracks
                        // -- min-w-0 here is what lets this item actually
                        // shrink to that track width instead of asserting
                        // its own min-content). No visual styling of its
                        // own -- each layout below owns its full card
                        // (border, background, padding) independently.
                        <div key={app.id} className="min-w-0">
                          {/* Desktop (>=640px) -- untouched: the exact
                              original single-row card. */}
                          <div className="hidden sm:block">
                            <div
                              className={`flex items-center gap-3 rounded-xl border p-3 transition hover:shadow-sm ${
                                isPremium
                                  ? "border-purple-200 bg-gradient-to-br from-purple-50/60 to-white hover:border-purple-300"
                                  : "border-gray-100 bg-gray-50/40 hover:border-gray-200"
                              }`}
                            >
                              {avatar}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`min-w-0 truncate text-sm ${
                                      isPremium
                                        ? "font-semibold text-gray-900"
                                        : "font-medium text-gray-500"
                                    }`}
                                  >
                                    {app.name}
                                  </span>
                                  {badge}
                                </div>
                                <p
                                  className={`truncate text-xs ${
                                    isPremium ? "text-gray-600" : "text-gray-400"
                                  }`}
                                >
                                  {descriptionText}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {upgradeLink}
                                {externalLink}
                              </div>
                            </div>
                          </div>

                          {/* Mobile (<640px) -- rebuilt from zero as a
                              plain vertical block card, not a horizontal
                              row of any kind. Every element here is a
                              normal block box (logo, then name, then
                              badge, then description, then a divider,
                              then the button, each simply stacked) --
                              normal block children always take exactly
                              their parent's width and can never force it
                              wider, which is what makes this structurally
                              immune to the overflow this card kept
                              hitting as a flex row. The only flex used
                              anywhere below is inside the button itself,
                              to center its label and icon. */}
                          <div className="block sm:hidden">
                            <div
                              className={`w-full max-w-full box-border rounded-xl border p-3 ${
                                isPremium
                                  ? "border-purple-200 bg-gradient-to-br from-purple-50/60 to-white"
                                  : "border-gray-100 bg-gray-50/40"
                              }`}
                            >
                              <div>{avatar}</div>
                              <p
                                className={`mt-3 break-words text-sm ${
                                  isPremium
                                    ? "font-semibold text-gray-900"
                                    : "font-medium text-gray-500"
                                }`}
                              >
                                {app.name}
                              </p>
                              <span
                                className={`mt-1 inline-block w-fit rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                  isPremium
                                    ? "bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-white"
                                    : "bg-gray-200 text-gray-500"
                                }`}
                              >
                                {isPremium ? t("dashboard.premium") : t("dashboard.standard")}
                              </span>
                              <p
                                className={`mt-3 break-words text-xs ${
                                  isPremium ? "text-gray-600" : "text-gray-400"
                                }`}
                              >
                                {descriptionText}
                              </p>
                              {!isPremium && (
                                <>
                                  <div className="my-3 border-t border-gray-100" />
                                  <Link
                                    to="/pricing"
                                    search={{ app: app.slug }}
                                    className="flex w-full max-w-full box-border items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                                  >
                                    <span>{t("dashboard.upgrade")}</span>
                                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                                  </Link>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </div>

          {/* RIGHT column */}
          <div className="flex min-w-0 flex-col gap-6">
            {/* Active subscription */}
            {isWidgetEnabled("active_subscription") && (
              <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#1D6BF3] to-[#6366F1] p-6 text-white shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wide opacity-80">
                    {t("dashboard.activeSubscription")}
                  </h3>
                  <Crown className="h-4 w-4 opacity-80" />
                </div>
                {subsQuery.isLoading ? (
                  <Skeleton className="h-16 w-full bg-white/20" />
                ) : activeSub ? (
                  <div>
                    <p className="text-xl font-semibold">
                      {activeSub.plan?.name ?? t("dashboard.premium")}
                    </p>
                    <p className="mt-1 text-xs opacity-80">
                      {t("dashboard.validUntil")}:{" "}
                      {new Date(activeSub.expires_at).toLocaleDateString(i18n.language)}
                    </p>
                    <Link
                      to="/dashboard/purchases"
                      className="mt-4 inline-flex items-center justify-center rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur hover:bg-white/25"
                    >
                      {t("subscription.managePlan")}
                    </Link>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm opacity-90">{t("dashboard.noSubscription")}</p>
                    <Link
                      to="/pricing"
                      className="mt-3 inline-flex items-center justify-center rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#1D6BF3] hover:bg-white/90"
                    >
                      {t("dashboard.upgrade")}
                    </Link>
                  </div>
                )}
              </section>
            )}

            {/* Activity overview: connected applications. Rewards and
                Advertising have their own permanent, unconditional section
                at the top of the page (RewardsAdvertisingCards) -- this
                remaining stat is unrelated and keeps its existing
                my_applications widget gating, unchanged. */}
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h3 className="mb-3 text-sm font-semibold">{t("dashboard.activityOverview")}</h3>
              <div className="space-y-3">
                {isWidgetEnabled("my_applications") && (
                  <div className="rounded-xl border border-gray-100 p-3">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                      <User className="h-3.5 w-3.5 text-[#1D6BF3]" />
                      {t("dashboard.connectedApps")}
                    </span>
                    {appsQuery.isLoading ? (
                      <Skeleton className="mt-2 h-6 w-16" />
                    ) : (
                      <div className="mt-1.5 flex items-baseline justify-between gap-2">
                        <p className="text-xl font-semibold text-gray-900">
                          {appsQuery.data?.length ?? 0}
                        </p>
                        <span className="shrink-0 text-[11px] text-gray-500">
                          {t("dashboard.activeSubscriptionsCount", {
                            count: subsQuery.data?.length ?? 0,
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Payment history */}
            {isWidgetEnabled("payment_history") && (
              <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t("dashboard.paymentHistory")}</h3>
                  <Link
                    to="/dashboard/purchases"
                    className="text-xs font-medium text-[#1D6BF3] hover:underline"
                  >
                    {t("dashboard.viewAll")}
                  </Link>
                </div>
                {paymentsQuery.isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full rounded-lg" />
                    ))}
                  </div>
                ) : (paymentsQuery.data?.length ?? 0) === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-500">
                    {t("dashboard.noPayments")}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {paymentsQuery.data!.map((p) => (
                      <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                        <div>
                          <p className="font-medium">
                            {p.amount.toFixed(2)} {p.currency}
                          </p>
                          <p className="text-xs text-gray-500">
                            {new Date(p.created_at).toLocaleDateString(i18n.language)}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            p.status === "success"
                              ? "bg-emerald-100 text-emerald-700"
                              : p.status === "pending"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {p.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/* Quick links */}
            {isWidgetEnabled("quick_links") && (
              <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
                <h3 className="mb-3 text-sm font-semibold">{t("dashboard.quickLinks")}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { to: "/dashboard/profile", icon: User, label: t("nav.profile") },
                    { to: "/dashboard/settings", icon: Settings, label: t("nav.settings") },
                    { to: "/dashboard/security", icon: Shield, label: t("nav.security") },
                    ...(rewardsEnabled
                      ? [{ to: "/dashboard/rewards" as const, icon: Gift, label: t("nav.rewards") }]
                      : []),
                    ...(advertisingEnabled
                      ? [
                          {
                            to: "/dashboard/advertising" as const,
                            icon: Megaphone,
                            label: t("nav.advertising"),
                          },
                        ]
                      : []),
                    { to: "/dashboard/help", icon: HelpCircle, label: t("nav.help") },
                  ].map((q) => (
                    <Link
                      key={q.label}
                      to={q.to}
                      className="flex min-w-0 items-center gap-2 rounded-xl border border-gray-100 p-3 text-xs font-medium text-gray-700 transition hover:border-gray-200 hover:bg-gray-50"
                    >
                      <q.icon className="h-4 w-4 shrink-0 text-[#1D6BF3]" />
                      <span className="min-w-0 truncate">{q.label}</span>
                      <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-gray-400" />
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {isWidgetEnabled("share_and_invite") && (
              <ShareAndInvite
                username={profile?.username ?? null}
                firstName={profile?.first_name ?? null}
                lastName={profile?.last_name ?? null}
              />
            )}
          </div>

          {/* Footer */}
          <footer className="lg:col-span-3">
            <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-6 py-4 text-xs text-gray-500 sm:flex-row">
              <p className="text-center">
                © {new Date().getFullYear()} Core Platform · {t("dashboard.footerRights")}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <span className="flex items-center gap-1">
                  <Lock className="h-3 w-3 text-emerald-500" />
                  {t("dashboard.trustSecure")}
                </span>
                <span className="flex items-center gap-1">
                  <Shield className="h-3 w-3 text-[#1D6BF3]" />
                  {t("dashboard.trustGDPR")}
                </span>
                <span className="flex items-center gap-1">
                  <HelpCircle className="h-3 w-3 text-[#F59E0B]" />
                  {t("dashboard.trustSupport")}
                </span>
              </div>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  onSignOut,
  rewardsEnabled,
  advertisingEnabled,
  messagingEnabled,
}: {
  onSignOut: () => void;
  rewardsEnabled: boolean;
  advertisingEnabled: boolean;
  messagingEnabled: boolean;
}) {
  const { t } = useTranslation();
  const items = getDashboardNavItems(t, { rewardsEnabled, advertisingEnabled, messagingEnabled });

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-gray-100 bg-white lg:flex">
      <div className="flex h-16 items-center gap-2 border-b border-gray-100 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#1D6BF3] to-[#6366F1] text-sm font-bold text-white">
          C
        </div>
        <span className="text-sm font-semibold">Core Platform</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {items.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            activeOptions={{ exact: true }}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
            activeProps={{
              className:
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium bg-[#1D6BF3]/10 text-[#1D6BF3]",
            }}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="border-t border-gray-100 p-3">
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{t("nav.logout")}</span>
        </button>
      </div>
    </aside>
  );
}
