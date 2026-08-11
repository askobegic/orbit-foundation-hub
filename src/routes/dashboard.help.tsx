import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, HelpCircle, Send, BookOpen, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardMobileNav } from "@/components/dashboard/DashboardNav";
import { useApplication } from "@/context/ApplicationContext";
import {
  createSupportTicket,
  getMySupportTicketMessages,
  getMySupportTickets,
  replySupportTicket,
} from "@/lib/support.functions";

type TicketRow = Awaited<ReturnType<typeof getMySupportTickets>>[number];

export const Route = createFileRoute("/dashboard/help")({
  head: () => ({
    meta: [
      { title: "Pomoć i podrška — Core Platform" },
      { name: "description", content: "Česta pitanja i kontakt sa podrškom." },
      { property: "og:title", content: "Pomoć i podrška — Core Platform" },
      { property: "og:description", content: "Česta pitanja i kontakt sa podrškom." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <HelpPage />
    </ProtectedRoute>
  ),
});

function HelpPage() {
  const { t } = useTranslation();
  const { application } = useApplication();
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("general");
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const faqs = (t("help.faqs", { returnObjects: true }) as Array<{ q: string; a: string }>) || [];

  // Priority 15 Phase D (15.12): a real, persistent support ticket system
  // -- replaces the previous fire-and-forget sendSupportRequest() n8n
  // webhook stub (no DB row, no reply, no inbox) with createSupportTicket/
  // getMySupportTickets/replySupportTicket. Same page, same "Contact"
  // section -- not a second entry point.
  const createFn = useServerFn(createSupportTicket);
  const doCreate = useMutation({
    mutationFn: () =>
      createFn({
        data: { subject: subject.trim(), message: message.trim(), category, appId: application?.id ?? null },
      }),
    onSuccess: () => {
      toast.success(t("help.sent"));
      setSubject("");
      setMessage("");
      void qc.invalidateQueries({ queryKey: ["my-support-tickets"] });
    },
    onError: () => toast.error(t("common.errorGeneric")),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || message.trim().length < 5) {
      toast.error(t("help.formInvalid"));
      return;
    }
    doCreate.mutate();
  }

  const listFn = useServerFn(getMySupportTickets);
  const ticketsQ = useQuery({ queryKey: ["my-support-tickets"], queryFn: () => listFn() });

  const [selected, setSelected] = useState<TicketRow | null>(null);
  const msgFn = useServerFn(getMySupportTicketMessages);
  const messagesQ = useQuery({
    queryKey: ["my-support-messages", selected?.id],
    enabled: !!selected,
    queryFn: () => msgFn({ data: { ticketId: selected!.id } }),
  });

  const [reply, setReply] = useState("");
  const replyFn = useServerFn(replySupportTicket);
  const doReply = useMutation({
    mutationFn: () => replyFn({ data: { ticketId: selected!.id, body: reply.trim() } }),
    onSuccess: () => {
      setReply("");
      void qc.invalidateQueries({ queryKey: ["my-support-messages", selected?.id] });
      void qc.invalidateQueries({ queryKey: ["my-support-tickets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F59E0B]/10 text-[#F59E0B]">
            <HelpCircle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("help.title")}</h1>
            <p className="text-sm text-gray-500">{t("help.subtitle")}</p>
          </div>
        </header>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="mb-3 text-sm font-semibold">{t("help.faq")}</h2>
          <ul className="divide-y divide-gray-100">
            {faqs.map((f, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setOpenIdx(openIdx === i ? null : i)}
                  className="flex w-full items-center justify-between py-3 text-left text-sm font-medium text-gray-800"
                >
                  {f.q}
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition ${
                      openIdx === i ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {openIdx === i && (
                  <p className="pb-3 text-sm text-gray-600">{f.a}</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="mb-3 text-sm font-semibold">{t("help.docsTitle")}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[
              { href: "/pricing", label: t("help.docsPricing") },
              { href: "/dashboard/profile", label: t("help.docsProfile") },
              { href: "/dashboard/settings", label: t("help.docsSettings") },
              { href: "/dashboard/purchases", label: t("help.docsSubs") },
            ].map((d) => (
              <a
                key={d.href}
                href={d.href}
                className="flex items-center gap-2 rounded-xl border border-gray-100 p-3 text-sm text-gray-700 hover:border-gray-200 hover:bg-gray-50"
              >
                <BookOpen className="h-4 w-4 text-[#1D6BF3]" />
                {d.label}
              </a>
            ))}
          </ul>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="mb-1 text-sm font-semibold">{t("help.contactTitle")}</h2>
          <p className="mb-4 text-xs text-gray-500">{t("help.contactHint")}</p>
          <form onSubmit={onSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {t("help.category")}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <option value="general">{t("help.catGeneral")}</option>
                <option value="billing">{t("help.catBilling")}</option>
                <option value="technical">{t("help.catTechnical")}</option>
                <option value="account">{t("help.catAccount")}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {t("help.subject")}
              </label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                {t("help.message")}
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                required
              />
            </div>
            <button
              type="submit"
              disabled={doCreate.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white hover:bg-[#1858cf] disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {doCreate.isPending ? t("common.saving") : t("help.send")}
            </button>
          </form>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="mb-3 text-sm font-semibold">{t("help.yourRequests")}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto">
              {(ticketsQ.data ?? []).map((ticket) => (
                <li key={ticket.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(ticket)}
                    className={`block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-gray-50 ${selected?.id === ticket.id ? "bg-blue-50" : ""}`}
                  >
                    <span className="font-medium text-gray-800">{ticket.subject}</span>
                    <span className="block text-xs text-gray-500">{t(`help.requestStatus_${ticket.status}`)}</span>
                  </button>
                </li>
              ))}
              {(ticketsQ.data ?? []).length === 0 && (
                <p className="py-2 text-sm text-gray-500">{t("help.noRequests")}</p>
              )}
            </ul>
            <div>
              {selected ? (
                <div className="rounded-xl border border-gray-100 p-3">
                  <ul className="max-h-56 space-y-2 overflow-y-auto">
                    {(messagesQ.data ?? []).map((m) => (
                      <li
                        key={m.id}
                        className={`rounded-lg p-2 text-xs ${m.sender_role === "admin" ? "bg-blue-50" : "bg-gray-50"}`}
                      >
                        <span className="font-medium">{t(`help.requestSender_${m.sender_role}`)}</span>: {m.body}
                      </li>
                    ))}
                  </ul>
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    rows={3}
                    placeholder={t("help.requestReplyPlaceholder")}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => doReply.mutate()}
                    disabled={!reply.trim() || doReply.isPending}
                    className="mt-2 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {t("help.requestSend")}
                  </button>
                </div>
              ) : (
                <p className="text-sm text-gray-500">{t("help.selectRequest")}</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}