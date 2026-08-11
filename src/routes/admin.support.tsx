// Priority 15 Phase D (15.12): Admin Support Inbox -- a simple ticket
// system, not the social Messaging admin surface. Same Card-based pattern
// as /admin/events, /admin/engagement.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { getMyIsAdmin } from "@/lib/admin.functions";
import {
  adminGetSupportTicketMessages,
  adminListSupportTickets,
  adminReplySupportTicket,
  adminSetSupportTicketPriority,
  adminSetSupportTicketStatus,
} from "@/lib/support.functions";

export const Route = createFileRoute("/admin/support")({
  head: () => ({
    meta: [
      { title: "Admin · Support — Core Platform" },
      { name: "description", content: "User support tickets." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminSupport />
    </ProtectedRoute>
  ),
});

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

type TicketRow = Awaited<ReturnType<typeof adminListSupportTickets>>[number];

function AdminSupport() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdminFn = useServerFn(getMyIsAdmin);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn() });
  useEffect(() => {
    if (adminQ.data && !adminQ.data.isAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [adminQ.data, navigate]);

  const [statusFilter, setStatusFilter] = useState<"" | "open" | "in_progress" | "closed">("open");
  const [selected, setSelected] = useState<TicketRow | null>(null);

  const listFn = useServerFn(adminListSupportTickets);
  const ticketsQ = useQuery({
    queryKey: ["admin-support-tickets", statusFilter],
    queryFn: () => listFn({ data: { status: statusFilter || undefined } }),
  });

  const msgFn = useServerFn(adminGetSupportTicketMessages);
  const messagesQ = useQuery({
    queryKey: ["admin-support-messages", selected?.id],
    enabled: !!selected,
    queryFn: () => msgFn({ data: { ticketId: selected!.id } }),
  });

  const replyFn = useServerFn(adminReplySupportTicket);
  const [reply, setReply] = useState("");
  const [isInternalNote, setIsInternalNote] = useState(false);
  const doReply = useMutation({
    mutationFn: () =>
      replyFn({ data: { ticketId: selected!.id, body: reply.trim(), isInternalNote } }),
    onSuccess: () => {
      setReply("");
      void qc.invalidateQueries({ queryKey: ["admin-support-messages", selected?.id] });
      void qc.invalidateQueries({ queryKey: ["admin-support-tickets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusFn = useServerFn(adminSetSupportTicketStatus);
  const doSetStatus = useMutation({
    mutationFn: (status: "open" | "in_progress" | "closed") =>
      statusFn({ data: { ticketId: selected!.id, status } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-support-tickets"] });
      toast.success(t("admin.support.statusUpdated"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const priorityFn = useServerFn(adminSetSupportTicketPriority);
  const doSetPriority = useMutation({
    mutationFn: (priority: "low" | "normal" | "high") =>
      priorityFn({ data: { ticketId: selected!.id, priority } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-support-tickets"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> {t("admin.common.back")}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.support.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.support.subtitle")}</p>

        <Card title={t("admin.support.ticketsTitle")}>
          <div className="mb-3 flex gap-2">
            {(["", "open", "in_progress", "closed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-lg px-3 py-1 text-xs font-medium ${statusFilter === s ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}
              >
                {s === "" ? t("admin.support.all") : t(`admin.support.status_${s}`)}
              </button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
              {(ticketsQ.data ?? []).map((ticket) => {
                const t2 = ticket as unknown as TicketRow & {
                  profiles: { username: string | null; first_name: string | null; last_name: string | null } | null;
                };
                return (
                  <li key={t2.id}>
                    <button
                      onClick={() => setSelected(t2)}
                      className={`block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-gray-50 ${selected?.id === t2.id ? "bg-blue-50" : ""}`}
                    >
                      <span className="font-medium text-gray-800">{t2.subject}</span>
                      <span className="block text-xs text-gray-500">
                        {t2.profiles?.username ?? t2.profiles?.first_name ?? "—"} · {t2.status} · {t2.priority}
                      </span>
                    </button>
                  </li>
                );
              })}
              {(ticketsQ.data ?? []).length === 0 && (
                <p className="py-2 text-sm text-gray-500">{t("admin.support.noTickets")}</p>
              )}
            </ul>

            <div>
              {selected ? (
                <div className="rounded-xl border border-gray-100 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <select
                      value={selected.status}
                      onChange={(e) => doSetStatus.mutate(e.target.value as "open" | "in_progress" | "closed")}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
                    >
                      <option value="open">{t("admin.support.status_open")}</option>
                      <option value="in_progress">{t("admin.support.status_in_progress")}</option>
                      <option value="closed">{t("admin.support.status_closed")}</option>
                    </select>
                    <select
                      value={selected.priority}
                      onChange={(e) => doSetPriority.mutate(e.target.value as "low" | "normal" | "high")}
                      className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
                    >
                      <option value="low">{t("admin.support.priorityLow")}</option>
                      <option value="normal">{t("admin.support.priorityNormal")}</option>
                      <option value="high">{t("admin.support.priorityHigh")}</option>
                    </select>
                  </div>
                  <ul className="max-h-60 space-y-2 overflow-y-auto">
                    {(messagesQ.data ?? []).map((m) => (
                      <li
                        key={m.id}
                        className={`rounded-lg p-2 text-xs ${m.is_internal_note ? "bg-amber-50" : m.sender_role === "admin" ? "bg-blue-50" : "bg-gray-50"}`}
                      >
                        <span className="font-medium">
                          {m.is_internal_note ? t("admin.support.internalNote") : m.sender_role}
                        </span>
                        : {m.body}
                      </li>
                    ))}
                  </ul>
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={3}
                    placeholder={t("admin.support.replyPlaceholder")}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={isInternalNote}
                        onChange={(e) => setIsInternalNote(e.target.checked)}
                      />
                      {t("admin.support.internalNote")}
                    </label>
                    <button
                      onClick={() => doReply.mutate()}
                      disabled={!reply.trim() || doReply.isPending}
                      className="rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {t("admin.support.send")}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">{t("admin.support.selectTicket")}</p>
              )}
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
