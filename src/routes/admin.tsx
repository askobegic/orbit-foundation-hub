import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  const q = useQuery({
    queryKey: ["is-admin"],
    queryFn: async () => {
      const res = await isAdminFn();
      console.log("[admin] getMyIsAdmin result:", res);
      return res;
    },
    retry: 1,
  });
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    console.log("[admin] query state:", { status: q.status, data: q.data, error: q.error });
    if (q.data && !q.data.isAdmin) {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [q.status, q.data, q.error, navigate]);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(t);
  }, []);

  if (q.isLoading) {
    if (timedOut) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-6">
          <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-100">
            <h1 className="text-lg font-semibold text-gray-900">Provjera pristupa traje predugo</h1>
            <p className="mt-2 text-sm text-gray-500">Vraćamo vas na kontrolnu ploču.</p>
            <button
              onClick={() => void navigate({ to: "/dashboard", replace: true })}
              className="mt-4 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white"
            >
              Idi na dashboard
            </button>
          </div>
        </main>
      );
    }
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