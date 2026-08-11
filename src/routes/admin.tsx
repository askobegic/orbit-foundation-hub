import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  BadgeCheck,
  Clock,
  CreditCard,
  Gift,
  Image,
  LayoutGrid,
  MegaphoneIcon,
  Sliders,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { adminOverviewStats } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Core Platform" },
      { name: "description", content: "Administratorski panel Core Platforme." },
      { property: "og:title", content: "Admin — Core Platform" },
      { property: "og:description", content: "Administratorski panel Core Platforme." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminGate />
    </ProtectedRoute>
  ),
});

function AdminGate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const q = useQuery({
    queryKey: ["is-admin", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      if (!user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single();
      if (error && error.code !== "PGRST116") throw new Error(error.message);
      const role = (data?.role ?? null) as string | null;
      return { isAdmin: role === "admin", role };
    },
    retry: 1,
  });
  useEffect(() => {
    if (q.isSuccess && !q.data?.isAdmin) {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [q.isSuccess, q.data, navigate]);

  if (q.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1D6BF3] border-t-transparent" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-100">
          <h1 className="text-lg font-semibold text-gray-900">{t("admin.hub.checkAccessError")}</h1>
          <p className="mt-2 text-sm text-gray-500">{(q.error as Error)?.message ?? t("admin.common.unknownError")}</p>
          <button
            onClick={() => void navigate({ to: "/dashboard", replace: true })}
            className="mt-4 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white"
          >
            {t("admin.hub.backToDashboard")}
          </button>
        </div>
      </main>
    );
  }

  if (!q.data?.isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-100">
          <h1 className="text-lg font-semibold text-gray-900">{t("admin.hub.noAccessTitle")}</h1>
          <p className="mt-2 text-sm text-gray-500">{t("admin.hub.noAccessBody")}</p>
        </div>
      </main>
    );
  }

  if (location.pathname !== "/admin") {
    return <Outlet />;
  }

  const cards = [
    {
      to: "/admin/applications",
      icon: LayoutGrid,
      title: t("admin.hub.cards.applications.title"),
      desc: t("admin.hub.cards.applications.desc"),
    },
    {
      to: "/admin/users",
      icon: Users,
      title: t("admin.hub.cards.users.title"),
      desc: t("admin.hub.cards.users.desc"),
    },
    {
      to: "/admin/communication",
      icon: MegaphoneIcon,
      title: t("admin.hub.cards.communication.title"),
      desc: t("admin.hub.cards.communication.desc"),
    },
    {
      to: "/admin/payments",
      icon: Wallet,
      title: t("admin.hub.cards.payments.title"),
      desc: t("admin.hub.cards.payments.desc"),
    },
    {
      to: "/admin/verification",
      icon: BadgeCheck,
      title: t("admin.hub.cards.verification.title"),
      desc: t("admin.hub.cards.verification.desc"),
    },
    {
      to: "/admin/advertising",
      icon: Image,
      title: t("admin.hub.cards.advertising.title"),
      desc: t("admin.hub.cards.advertising.desc"),
    },
    {
      to: "/admin/trials",
      icon: Clock,
      title: t("admin.hub.cards.trials.title"),
      desc: t("admin.hub.cards.trials.desc"),
    },
    {
      to: "/admin/capabilities",
      icon: Sliders,
      title: t("admin.hub.cards.capabilities.title"),
      desc: t("admin.hub.cards.capabilities.desc"),
    },
    {
      to: "/admin/dashboard-widgets",
      icon: LayoutGrid,
      title: t("admin.hub.cards.dashboardWidgets.title"),
      desc: t("admin.hub.cards.dashboardWidgets.desc"),
    },
    {
      to: "/admin/rewards",
      icon: Gift,
      title: t("admin.hub.cards.rewards.title"),
      desc: t("admin.hub.cards.rewards.desc"),
    },
    {
      to: "/admin/events",
      icon: Zap,
      title: t("admin.hub.cards.events.title"),
      desc: t("admin.hub.cards.events.desc"),
    },
    {
      to: "/admin/engagement",
      icon: Target,
      title: t("admin.hub.cards.engagement.title"),
      desc: t("admin.hub.cards.engagement.desc"),
    },
  ];
  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.hub.title")}</h1>
        <OverviewStats />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100 transition hover:ring-[#1D6BF3]"
            >
              <c.icon className="h-6 w-6 text-[#1D6BF3]" />
              <h3 className="mt-3 text-base font-semibold">{c.title}</h3>
              <p className="mt-1 text-sm text-gray-500">{c.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}

function OverviewStats() {
  const { t } = useTranslation();
  const statsFn = useServerFn(adminOverviewStats);
  const q = useQuery({ queryKey: ["admin-overview"], queryFn: () => statsFn() });
  const s = q.data;
  const items = [
    { icon: Users, label: t("admin.hub.stats.totalUsers"), value: s?.totalUsers ?? "—", tone: "text-[#1D6BF3]" },
    { icon: CreditCard, label: t("admin.hub.stats.activePremium"), value: s?.activePremium ?? "—", tone: "text-purple-600" },
    { icon: TrendingUp, label: t("admin.hub.stats.revenueThisMonth"), value: s ? `€${s.revenueThisMonth.toFixed(2)}` : "—", tone: "text-green-600" },
    { icon: UserPlus, label: t("admin.hub.stats.newUsersThisWeek"), value: s?.newUsersThisWeek ?? "—", tone: "text-orange-600" },
  ];
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{i.label}</span>
            <i.icon className={`h-5 w-5 ${i.tone}`} />
          </div>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{q.isLoading ? "…" : i.value}</p>
        </div>
      ))}
    </div>
  );
}