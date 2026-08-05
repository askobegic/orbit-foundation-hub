import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  BadgeCheck,
  Crown,
  Pencil,
  Search,
  Trash2,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import {
  adminDeleteUser,
  adminGrantPremium,
  adminListAuditLogs,
  adminListUsers,
  adminRevokePremium,
  adminSetUserActive,
  adminSetVerified,
  adminUpdateUser,
  getMyIsAdmin,
} from "@/lib/admin.functions";
import type { ApplicationRow } from "@/types/database";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Admin · Users — Core Platform" },
      { name: "description", content: "Manage users and Premium access." },
      { property: "og:title", content: "Admin · Users — Core Platform" },
      { property: "og:description", content: "Manage users and Premium access." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminUsers />
    </ProtectedRoute>
  ),
});

type UserRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  is_premium: boolean;
  city: string | null;
  country: string | null;
  is_verified: boolean | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

const PAGE_SIZE = 25;

function AdminUsers() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdminFn = useServerFn(getMyIsAdmin);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn() });
  useEffect(() => {
    if (adminQ.data && !adminQ.data.isAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [adminQ.data, navigate]);

  const [search, setSearch] = useState("");
  const [premiumFilter, setPremiumFilter] = useState<"" | "premium" | "standard">("");
  const [verifiedFilter, setVerifiedFilter] = useState<"" | "true" | "false">("");
  const [activeFilter, setActiveFilter] = useState<"" | "true" | "false">("");
  const [page, setPage] = useState(1);

  const listFn = useServerFn(adminListUsers);
  const auditFn = useServerFn(adminListAuditLogs);
  const grant = useServerFn(adminGrantPremium);
  const revoke = useServerFn(adminRevokePremium);
  const updateUser = useServerFn(adminUpdateUser);
  const setActive = useServerFn(adminSetUserActive);
  const deleteUser = useServerFn(adminDeleteUser);
  const setVerified = useServerFn(adminSetVerified);

  const usersQ = useQuery({
    queryKey: ["admin-users", search, premiumFilter, verifiedFilter, activeFilter, page],
    queryFn: () =>
      listFn({
        data: {
          search,
          premiumFilter: premiumFilter || undefined,
          is_verified: verifiedFilter === "" ? undefined : verifiedFilter === "true",
          is_active: activeFilter === "" ? undefined : activeFilter === "true",
          page,
          pageSize: PAGE_SIZE,
        },
      }),
  });
  const rows = (usersQ.data?.rows ?? []) as UserRow[];
  const total = usersQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const auditQ = useQuery({ queryKey: ["admin-audit"], queryFn: () => auditFn() });

  const appsQ = useQuery({
    queryKey: ["admin-apps-simple"],
    queryFn: async () => {
      const { data } = await supabase.from("applications").select("id, name, primary_color");
      return (data ?? []) as Pick<ApplicationRow, "id" | "name" | "primary_color">[];
    },
  });

  const [modal, setModal] = useState<null | UserRow>(null);
  const [editing, setEditing] = useState(false);
  const [editCity, setEditCity] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [selApp, setSelApp] = useState<string>("");
  const [months, setMonths] = useState<number>(12);
  const [reason, setReason] = useState("");

  function openModal(row: UserRow) {
    setModal(row);
    setEditing(false);
    setEditCity(row.city ?? "");
    setEditCountry(row.country ?? "");
    setEditUsername(row.username ?? "");
    setSelApp("");
  }

  const invalidateUsers = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const doGrant = useMutation({
    mutationFn: () =>
      grant({
        data: {
          user_id: modal!.id,
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
    queryKey: ["admin-user-subs", modal?.id],
    enabled: !!modal,
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("id, app_id, status, expires_at, applications:applications(name)")
        .eq("user_id", modal!.id);
      return data ?? [];
    },
  });

  const doRevoke = useMutation({
    mutationFn: (id: string) =>
      revoke({ data: { subscription_id: id, reason: reason || undefined } }),
    onSuccess: () => {
      toast.success("Revoked");
      qc.invalidateQueries({ queryKey: ["admin-user-subs"] });
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doUpdate = useMutation({
    mutationFn: () =>
      updateUser({
        data: {
          user_id: modal!.id,
          city: editCity.trim() || null,
          country: editCountry.trim() || null,
          username: editUsername.trim() || null,
        },
      }),
    onSuccess: (row) => {
      toast.success("User updated");
      setEditing(false);
      // adminUpdateUser returns the raw profiles row -- it never touches
      // Premium status, so carry the modal's existing is_premium forward
      // rather than re-deriving it (that lives only in adminListUsers).
      setModal((prev) => ({
        ...(row as Omit<UserRow, "is_premium">),
        is_premium: prev?.is_premium ?? false,
      }));
      invalidateUsers();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doSetActive = useMutation({
    mutationFn: (is_active: boolean) => setActive({ data: { user_id: modal!.id, is_active } }),
    onSuccess: (_row, is_active) => {
      toast.success(is_active ? "User reactivated" : "User suspended");
      setModal((m) => (m ? { ...m, is_active } : m));
      invalidateUsers();
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doVerify = useMutation({
    mutationFn: (verified: boolean) => setVerified({ data: { user_id: modal!.id, verified } }),
    onSuccess: (_r, verified) => {
      toast.success(verified ? "User verified" : "Verification revoked");
      setModal((m) => (m ? { ...m, is_verified: verified } : m));
      invalidateUsers();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const doDelete = useMutation({
    mutationFn: () => deleteUser({ data: { user_id: modal!.id } }),
    onSuccess: () => {
      toast.success("User deleted");
      setModal(null);
      invalidateUsers();
      qc.invalidateQueries({ queryKey: ["admin-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleDelete() {
    if (!modal) return;
    if (
      !window.confirm(
        `Delete ${modal.email ?? modal.id}? This permanently removes their account, subscriptions, payments, and profile data. This cannot be undone.`,
      )
    ) {
      return;
    }
    doDelete.mutate();
  }

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

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-1 min-w-[200px] items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-100">
            <Search className="h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search email, username, name…"
              className="w-full bg-transparent text-sm focus:outline-none"
            />
          </div>
          <select
            value={premiumFilter}
            onChange={(e) => {
              setPremiumFilter(e.target.value as "" | "premium" | "standard");
              setPage(1);
            }}
            className="rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-gray-100"
          >
            <option value="">All types</option>
            <option value="standard">Standard</option>
            <option value="premium">Premium</option>
          </select>
          <select
            value={verifiedFilter}
            onChange={(e) => {
              setVerifiedFilter(e.target.value as typeof verifiedFilter);
              setPage(1);
            }}
            className="rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-gray-100"
          >
            <option value="">Any verification</option>
            <option value="true">Verified</option>
            <option value="false">Not verified</option>
          </select>
          <select
            value={activeFilter}
            onChange={(e) => {
              setActiveFilter(e.target.value as typeof activeFilter);
              setPage(1);
            }}
            className="rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-gray-100"
          >
            <option value="">Active + suspended</option>
            <option value="true">Active only</option>
            <option value="false">Suspended only</option>
          </select>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Verified</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">City</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {usersQ.isLoading && (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={7}>
                    Loading…
                  </td>
                </tr>
              )}
              {!usersQ.isLoading && rows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={7}>
                    No users match these filters.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className={r.is_active === false ? "bg-red-50/40" : undefined}>
                  <td className="px-4 py-2">
                    {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{r.email}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        r.is_premium
                          ? "bg-gradient-to-r from-[#F59E0B] to-[#EF4444] text-white"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {r.is_premium ? "premium" : "standard"}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {r.is_verified ? (
                      <BadgeCheck className="h-4 w-4 text-[#1D6BF3]" />
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {r.is_active === false ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                        Suspended
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{r.city ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => openModal(r)}
                      className="rounded-lg bg-[#1D6BF3] px-3 py-1 text-xs font-medium text-white hover:bg-[#1858cf]"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
          <span>
            {total === 0
              ? "0 users"
              : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-xs">
              Page {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
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
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Manage {modal.email}</h3>
              <button onClick={() => setModal(null)} className="rounded-lg p-1 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* User details */}
            <div className="mb-4 rounded-xl border border-gray-100 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-gray-500">User details</p>
                <button
                  onClick={() => setEditing((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1D6BF3] hover:underline"
                >
                  <Pencil className="h-3 w-3" /> {editing ? "Cancel" : "Edit"}
                </button>
              </div>

              {!editing ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <Field
                    label="Name"
                    value={[modal.first_name, modal.last_name].filter(Boolean).join(" ") || "—"}
                  />
                  <Field label="Email" value={modal.email ?? "—"} />
                  <Field label="User type" value={modal.is_premium ? "premium" : "standard"} />
                  <Field label="Verified" value={modal.is_verified ? "Yes" : "No"} />
                  <Field label="Country" value={modal.country ?? "—"} />
                  <Field label="City" value={modal.city ?? "—"} />
                  <Field
                    label="Registered"
                    value={modal.created_at ? new Date(modal.created_at).toLocaleDateString() : "—"}
                  />
                  <Field
                    label="Last update"
                    value={modal.updated_at ? new Date(modal.updated_at).toLocaleDateString() : "—"}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Email" value={modal.email ?? "—"} />
                  <EditField label="Username" value={editUsername} onChange={setEditUsername} />
                  <EditField label="City" value={editCity} onChange={setEditCity} />
                  <EditField label="Country" value={editCountry} onChange={setEditCountry} />
                  <p className="col-span-2 text-[11px] text-gray-400">
                    Name, profile photo, and email come from the user's identity provider and are
                    locked — not editable here. Email is kept in sync automatically on every sign-in.
                  </p>
                  <button
                    onClick={() => doUpdate.mutate()}
                    disabled={doUpdate.isPending}
                    className="col-span-2 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1858cf] disabled:opacity-60"
                  >
                    {doUpdate.isPending ? "Saving…" : "Save changes"}
                  </button>
                </div>
              )}
            </div>

            {/* Account actions */}
            <div className="mb-4 flex flex-wrap gap-2 border-b border-gray-100 pb-4">
              {modal.is_active === false ? (
                <button
                  onClick={() => doSetActive.mutate(true)}
                  disabled={doSetActive.isPending}
                  className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
                >
                  <UserCheck className="h-3.5 w-3.5" /> Reactivate
                </button>
              ) : (
                <button
                  onClick={() => doSetActive.mutate(false)}
                  disabled={doSetActive.isPending}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                >
                  <UserX className="h-3.5 w-3.5" /> Suspend
                </button>
              )}
              {modal.is_verified ? (
                <button
                  onClick={() => doVerify.mutate(false)}
                  disabled={doVerify.isPending}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" /> Revoke verification
                </button>
              ) : (
                <button
                  onClick={() => doVerify.mutate(true)}
                  disabled={doVerify.isPending}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1858cf] disabled:opacity-60"
                >
                  <BadgeCheck className="h-3.5 w-3.5" /> Approve verification
                </button>
              )}
              <button
                onClick={handleDelete}
                disabled={doDelete.isPending}
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete user
              </button>
            </div>

            {/* Premium */}
            <div className="mb-4 space-y-2">
              <p className="text-xs font-semibold uppercase text-gray-500">Active subscriptions</p>
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
              <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Grant premium</p>
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="text-gray-900">{value}</div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-gray-200 px-2 py-1 text-sm"
      />
    </label>
  );
}
