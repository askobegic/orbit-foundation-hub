import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BadgeCheck,
  CreditCard,
  Image,
  LayoutGrid,
  MegaphoneIcon,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
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
          <h1 className="text-lg font-semibold text-gray-900">Nije moguće provjeriti admin pristup</h1>
          <p className="mt-2 text-sm text-gray-500">{(q.error as Error)?.message ?? "Nepoznata greška"}</p>
          <button
            onClick={() => void navigate({ to: "/dashboard", replace: true })}
            className="mt-4 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white"
          >
            Nazad na dashboard
          </button>
        </div>
      </main>
    );
  }

  if (!q.data?.isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-100">
          <h1 className="text-lg font-semibold text-gray-900">Nemate pristup</h1>
          <p className="mt-2 text-sm text-gray-500">Ova stranica je dostupna samo administratorima.</p>
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
      title: "Applications & Plans",
      desc: "Manage apps, Premium plans and payment links.",
    },
    {
      to: "/admin/users",
      icon: Users,
      title: "Users & Subscriptions",
      desc: "Grant or revoke Premium, view audit log.",
    },
    {
      to: "/admin/communication",
      icon: MegaphoneIcon,
      title: "Communication",
      desc: "Broadcast notifications to all or Premium users.",
    },
    {
      to: "/admin/payments",
      icon: Wallet,
      title: "Payments",
      desc: "View full payments history across all apps.",
    },
    {
      to: "/admin/verification",
      icon: BadgeCheck,
      title: "Verification",
      desc: "Approve or reject user verification requests.",
    },
    {
      to: "/admin/advertising",
      icon: Image,
      title: "Advertising",
      desc: "Placements, pricing, moderation, and trusted advertisers.",
    },
  ] as const;
  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-2xl font-semibold text-gray-900">Admin</h1>
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
  const statsFn = useServerFn(adminOverviewStats);
  const q = useQuery({ queryKey: ["admin-overview"], queryFn: () => statsFn() });
  const s = q.data;
  const items = [
    { icon: Users, label: "Total users", value: s?.totalUsers ?? "—", tone: "text-[#1D6BF3]" },
    { icon: CreditCard, label: "Active Premium", value: s?.activePremium ?? "—", tone: "text-purple-600" },
    { icon: TrendingUp, label: "Revenue this month", value: s ? `€${s.revenueThisMonth.toFixed(2)}` : "—", tone: "text-green-600" },
    { icon: UserPlus, label: "New users this week", value: s?.newUsersThisWeek ?? "—", tone: "text-orange-600" },
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