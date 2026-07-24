import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import { adminSendNotification } from "@/lib/admin.functions";
import type { ApplicationRow } from "@/types/database";

export const Route = createFileRoute("/admin/communication")({
  head: () => ({
    meta: [
      { title: "Admin · Communication — Core Platform" },
      { name: "description", content: "Send notifications to users." },
      { property: "og:title", content: "Admin · Communication — Core Platform" },
      { property: "og:description", content: "Send notifications to users." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <CommunicationPage />
    </ProtectedRoute>
  ),
});

function CommunicationPage() {
  const send = useServerFn(adminSendNotification);
  const [target, setTarget] = useState<"all" | "premium" | "user">("all");
  const [userId, setUserId] = useState("");
  const [appId, setAppId] = useState<string>("");
  const [type, setType] = useState<"info" | "success" | "warning" | "error">("info");
  const [titleBs, setTitleBs] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [titleDe, setTitleDe] = useState("");
  const [msgBs, setMsgBs] = useState("");
  const [msgEn, setMsgEn] = useState("");
  const [msgDe, setMsgDe] = useState("");

  const appsQ = useQuery({
    queryKey: ["admin-apps-simple"],
    queryFn: async () => {
      const { data } = await supabase.from("applications").select("id, name");
      return (data ?? []) as Pick<ApplicationRow, "id" | "name">[];
    },
  });

  const mut = useMutation({
    mutationFn: () =>
      send({
        data: {
          target,
          user_id: target === "user" ? userId : undefined,
          app_id: appId || null,
          type,
          title_bs: titleBs,
          title_en: titleEn,
          title_de: titleDe,
          message_bs: msgBs,
          message_en: msgEn,
          message_de: msgDe,
        },
      }),
    onSuccess: (r) => {
      toast.success(`Sent to ${r.sent} user(s)`);
      setTitleBs(""); setTitleEn(""); setTitleDe("");
      setMsgBs(""); setMsgEn(""); setMsgDe("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Communication Center</h1>
        <p className="mt-1 text-sm text-gray-500">Broadcast notifications in BS / EN / DE.</p>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">
              Audience
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as typeof target)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="all">All users</option>
                <option value="premium">Premium users</option>
                <option value="user">Single user</option>
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">
              Application (optional)
              <select
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">— none —</option>
                {(appsQ.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            {target === "user" && (
              <label className="md:col-span-2 text-sm font-medium text-gray-700">
                User ID
                <input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="uuid"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
            )}
            <label className="text-sm font-medium text-gray-700">
              Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
            </label>
          </div>

          <div className="mt-6 space-y-4">
            {(["bs", "en", "de"] as const).map((lang) => {
              const title = lang === "bs" ? titleBs : lang === "en" ? titleEn : titleDe;
              const setTitle = lang === "bs" ? setTitleBs : lang === "en" ? setTitleEn : setTitleDe;
              const msg = lang === "bs" ? msgBs : lang === "en" ? msgEn : msgDe;
              const setMsg = lang === "bs" ? setMsgBs : lang === "en" ? setMsgEn : setMsgDe;
              return (
                <div key={lang} className="rounded-xl border border-gray-100 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{lang}</p>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                  <textarea
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    placeholder="Message"
                    rows={3}
                    className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
              );
            })}
          </div>

          <button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#1D6BF3] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#155ac9] disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {mut.isPending ? "Sending…" : "Send notification"}
          </button>
        </section>
      </div>
    </main>
  );
}