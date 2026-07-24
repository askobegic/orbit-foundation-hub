import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Crown, Search, X } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import {
  adminGrantPremium,
  adminListAuditLogs,
  adminListUsers,
  adminRevokePremium,
  getMyIsAdmin,
} from "@/lib/admin.functions";
import type { ApplicationRow } from "@/types/database";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Admin · Users — Core Platform" },
      { name: "description", content: "Grant or revoke Premium access." },
      { property: "og:title", content: "Admin · Users — Core Platform" },
      { property: "og:description", content: "Grant or revoke Premium access." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminUsers />
    </ProtectedRoute>
  ),
});

function AdminUsers() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdminFn = useServerFn(getMyIsAdmin);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn() });
  useEffect(() => {
    if (adminQ.data && !adminQ.data.isAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [adminQ.data, navigate]);

  const [search, setSearch] = useState("");
  const listFn = useServerFn(adminListUsers);
  const auditFn = useServerFn(adminListAuditLogs);
  const grant = useServerFn(adminGrantPremium);
  const revoke = useServerFn(adminRevokePremium);

  const usersQ = useQuery({
    queryKey: ["admin-users", search],
    queryFn: () => listFn({ data: { search } }),
  });
  const auditQ = useQuery({ queryKey: ["admin-audit"], queryFn: () => auditFn() });

  const appsQ = useQuery({
    queryKey: ["admin-apps-simple"],
    queryFn: async () => {
      const { data } = await supabase.from("applications").select("id, name, primary_color");
      return (data ?? []) as Pick<ApplicationRow, "id" | "name" | "primary_color">[];
    },
  });

  const [modal, setModal] = useState<null | { userId: string; email: string | null }>(null);
  const [selApp, setSelApp] = useState<string>("");
  const [months, setMonths] = useState<number>(12);
  const [reason, setReason] = useState("");

  const doGrant = useMutation({
    mutationFn: () =>
      grant({
        data: {
          user_id: modal!.userId,
          app_id: selApp,
          duration_months: months,
          reason: reason || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Premium granted");
      setModal(null);
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const userSubsQ = useQuery({
    queryKey: ["admin-user-subs", modal?.userId],
    enabled: !!modal,
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("id, app_id, status, expires_at, applications:applications(name)")
        .eq("user_id", modal!.userId);
      return data ?? [];
    },
  });

  const doRevoke = useMutation({
    mutationFn: (id: string) => revoke({ data: { subscription_id: id, reason: reason || undefined } }),
    onSuccess: () => {
      toast.success("Revoked");
      qc.invalidateQueries({ queryKey: ["admin-user-subs"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!adminQ.data?.isAdmin) return null;

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/admin"
          className="mb-4 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Admin
        </Link>
        <h1 className="mb-6 text-2xl font-semibold text-gray-900">Users</h1>

        <div className="mb-4 flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-100">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email, username, name…"
            className="w-full bg-transparent text-sm focus:outline-none"
          />
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">City</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(usersQ.data ?? []).map((u) => {
                const r = u as {
                  id: string;
                  email: string | null;
                  first_name: string | null;
                  last_name: string | null;
                  user_type: string | null;
                  city: string | null;
                };
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2">
                      {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{r.email}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          r.user_type === "premium"
                            ? "bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {r.user_type ?? "standard"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{r.city ?? "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => {
                          setModal({ userId: r.id, email: r.email });
                          setSelApp(appsQ.data?.[0]?.id ?? "");
                        }}
                        className="rounded-lg bg-[#1D6BF3] px-3 py-1 text-xs font-medium text-white hover:bg-[#1858cf]"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2 className="mb-3 mt-8 text-lg font-semibold">Audit log</h2>
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Entity</th>
                <th className="px-4 py-2">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(auditQ.data ?? []).map((a) => {
                const r = a as {
                  id: string;
                  created_at: string;
                  action: string;
                  entity_type: string;
                  entity_id: string | null;
                  user_id: string | null;
                };
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-gray-500">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 font-medium">{r.action}</td>
                    <td className="px-4 py-2 text-gray-500">
                      {r.entity_type} · {r.entity_id?.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{r.user_id?.slice(0, 8)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Manage {modal.email}</h3>
              <button onClick={() => setModal(null)} className="rounded-lg p-1 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 space-y-2">
              <p className="text-xs font-semibold uppercase text-gray-500">
                Active subscriptions
              </p>
              {(userSubsQ.data ?? []).length === 0 ? (
                <p className="text-sm text-gray-500">None</p>
              ) : (
                <ul className="space-y-1">
                  {(userSubsQ.data ?? []).map((s) => {
                    const r = s as {
                      id: string;
                      status: string;
                      expires_at: string;
                      applications: { name: string } | null;
                    };
                    return (
                      <li
                        key={r.id}
                        className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm"
                      >
                        <span>
                          {r.applications?.name ?? "?"} · {r.status} ·{" "}
                          {new Date(r.expires_at).toLocaleDateString()}
                        </span>
                        {r.status === "active" && (
                          <button
                            onClick={() => doRevoke.mutate(r.id)}
                            className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                          >
                            Revoke
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mb-3 border-t border-gray-100 pt-4">
              <p className="mb-2 text-xs font-semibold uppercase text-gray-500">
                Grant premium
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs">
                  App
                  <select
                    value={selApp}
                    onChange={(e) => setSelApp(e.target.value)}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                  >
                    {(appsQ.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Months
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={months}
                    onChange={(e) => setMonths(Number(e.target.value))}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                  />
                </label>
                <label className="col-span-2 flex flex-col gap-1 text-xs">
                  Reason
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
                    placeholder="Optional note logged in audit"
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                Close
              </button>
              <button
                onClick={() => doGrant.mutate()}
                disabled={!selApp || doGrant.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#F59E0B] to-[#EF4444] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <Crown className="h-4 w-4" />
                Grant Premium
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}