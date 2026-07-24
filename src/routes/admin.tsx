import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LayoutGrid, Users } from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { getMyIsAdmin } from "@/lib/admin.functions";

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
  const isAdminFn = useServerFn(getMyIsAdmin);
  const q = useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn() });
  useEffect(() => {
    if (q.data && !q.data.isAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [q.data, navigate]);
  if (!q.data?.isAdmin) return null;
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
  ] as const;
  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold text-gray-900">Admin</h1>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
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