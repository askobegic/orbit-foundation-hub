import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Home,
  User,
  LayoutGrid,
  CreditCard,
  Receipt,
  Settings,
  Shield,
  Bell,
  HelpCircle,
  LogOut,
  Crown,
  MapPin,
  ExternalLink,
  ChevronRight,
  Lock,
  BadgeCheck,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { Skeleton } from "@/components/ui/skeleton";
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
  const lang = (i18n.language?.slice(0, 2) ?? "bs") as "bs" | "en" | "de";

  const appsQuery = useQuery({
    queryKey: ["dashboard", "applications"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
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
        .eq("status", "active");
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

  const premiumAppIds = useMemo(
    () => new Set((subsQuery.data ?? []).map((s) => s.app_id).filter(Boolean) as string[]),
    [subsQuery.data],
  );
  const activeSub = subsQuery.data?.[0] ?? null;

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const initials =
    (profile?.first_name?.[0] ?? "") + (profile?.last_name?.[0] ?? "") || (user?.email?.[0] ?? "?");

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-gray-900">
      <Sidebar onSignOut={() => void signOut()} />

      <div className="lg:pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-gray-100 bg-white/80 px-4 backdrop-blur lg:px-8">
          <div>
            <h1 className="text-lg font-semibold">
              {t("dashboard.welcome")}
              {profile?.first_name ? `, ${profile.first_name}` : ""} 👋
            </h1>
            <p className="hidden text-xs text-gray-500 sm:block">{t("dashboard.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              type="button"
              aria-label={t("dashboard.notifications")}
              className="relative rounded-full border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-50"
            >
              <Bell className="h-4 w-4" />
              {(notificationsQuery.data ?? 0) > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#EF4444] px-1 text-[10px] font-semibold text-white">
                  {notificationsQuery.data}
                </span>
              )}
            </button>
            <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1 pl-1 pr-3">
              <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#1D6BF3] to-[#6366F1] text-xs font-semibold text-white">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials.toUpperCase()
                )}
              </span>
              <span className="hidden text-sm font-medium sm:inline">
                {fullName || user?.email}
              </span>
            </div>
          </div>
        </header>

        <main className="grid gap-6 p-4 lg:grid-cols-3 lg:p-8">
          {/* LEFT (2 cols) */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            {/* Profile card */}
            <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              <div className="h-24 bg-gradient-to-r from-[#1D6BF3] via-[#6366F1] to-[#8B5CF6]" />
              <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex items-end gap-4">
                  <div className="-mt-14 h-20 w-20 overflow-hidden rounded-2xl border-4 border-white bg-gray-100 shadow-sm">
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
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">
                        {fullName || user?.email || t("profile.notEntered")}
                      </h2>
                      {profile?.is_verified && (
                        <BadgeCheck className="h-4 w-4 text-[#1D6BF3]" aria-label={t("profile.verified")} />
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
                          profile?.user_type === "premium"
                            ? "bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {profile?.user_type === "premium" ? (
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
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold">{t("dashboard.myApps")}</h3>
                <span className="text-xs text-gray-400">
                  {appsQuery.data?.length ?? 0}
                </span>
              </div>
              {appsQuery.isLoading ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-xl" />
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(appsQuery.data ?? []).map((app) => {
                    const isPremium = premiumAppIds.has(app.id);
                    const desc =
                      app[`short_description_${lang}` as const] ??
                      app.short_description_en ??
                      "";
                    return (
                      <div
                        key={app.id}
                        className="flex items-center gap-3 rounded-xl border border-gray-100 p-3 transition hover:border-gray-200 hover:shadow-sm"
                      >
                        <div
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white"
                          style={{ backgroundColor: app.primary_color }}
                        >
                          {app.name.slice(0, 1)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{app.name}</span>
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                isPremium
                                  ? "bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white"
                                  : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              {isPremium ? t("dashboard.premium") : t("dashboard.standard")}
                            </span>
                          </div>
                          <p className="truncate text-xs text-gray-500">{desc}</p>
                        </div>
                        {app.status === "active" && app.domain ? (
                          <a
                            href={`https://${app.domain}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t("dashboard.openApp")}
                            className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-gray-700"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                            {t("dashboard.comingSoon")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* RIGHT column */}
          <div className="flex flex-col gap-6">
            {/* Active subscription */}
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
                  <button
                    type="button"
                    className="mt-4 inline-flex items-center justify-center rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur hover:bg-white/25"
                  >
                    {t("subscription.managePlan")}
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-sm opacity-90">{t("dashboard.noSubscription")}</p>
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center justify-center rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#1D6BF3] hover:bg-white/90"
                  >
                    {t("dashboard.upgrade")}
                  </button>
                </div>
              )}
            </section>

            {/* Payment history */}
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t("dashboard.paymentHistory")}</h3>
                <button className="text-xs font-medium text-[#1D6BF3] hover:underline">
                  {t("dashboard.viewAll")}
                </button>
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

            {/* Quick links */}
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h3 className="mb-3 text-sm font-semibold">{t("dashboard.quickLinks")}</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { to: "/dashboard/profile", icon: User, label: t("nav.profile") },
                  { to: "/dashboard", icon: Settings, label: t("nav.settings") },
                  { to: "/dashboard", icon: Shield, label: t("nav.security") },
                  { to: "/dashboard", icon: HelpCircle, label: t("nav.help") },
                ].map((q) => (
                  <Link
                    key={q.label}
                    to={q.to}
                    className="flex items-center gap-2 rounded-xl border border-gray-100 p-3 text-xs font-medium text-gray-700 transition hover:border-gray-200 hover:bg-gray-50"
                  >
                    <q.icon className="h-4 w-4 text-[#1D6BF3]" />
                    {q.label}
                    <ChevronRight className="ml-auto h-3 w-3 text-gray-400" />
                  </Link>
                ))}
              </div>
            </section>
          </div>

          {/* Footer */}
          <footer className="lg:col-span-3">
            <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-6 py-4 text-xs text-gray-500 sm:flex-row">
              <p>© {new Date().getFullYear()} Core Platform · {t("dashboard.footerRights")}</p>
              <div className="flex items-center gap-4">
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

function Sidebar({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useTranslation();
  const items = [
    { to: "/dashboard", icon: Home, label: t("nav.home") },
    { to: "/dashboard/profile", icon: User, label: t("nav.profile") },
    { to: "/dashboard", icon: LayoutGrid, label: t("nav.applications") },
    { to: "/dashboard", icon: CreditCard, label: t("nav.subscriptions") },
    { to: "/dashboard", icon: Receipt, label: t("nav.payments") },
    { to: "/dashboard", icon: Settings, label: t("nav.settings") },
    { to: "/dashboard", icon: Shield, label: t("nav.security") },
    { to: "/dashboard", icon: Bell, label: t("nav.notifications") },
    { to: "/dashboard", icon: HelpCircle, label: t("nav.help") },
  ] as const;

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
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-gray-100 p-3">
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
        >
          <LogOut className="h-4 w-4" />
          {t("nav.logout")}
        </button>
      </div>
    </aside>
  );
}