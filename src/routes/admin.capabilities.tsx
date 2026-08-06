// Priority 8.7 (C-1): Admin UI for the Capabilities system (Priority 8.1).
//
// Capability Definitions and Application Capabilities were fully
// implemented in the database and server functions (src/lib/
// capabilities.functions.ts) since Priority 8.1, but had no admin surface --
// every capability had to be registered/toggled via SQL. This page closes
// that gap, following the exact Card-based pattern already established by
// /admin/advertising.
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Archive, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminTogglePill } from "@/components/admin/AdminTogglePill";
import { supabase } from "@/integrations/supabase/client";
import { getMyIsAdmin } from "@/lib/admin.functions";
import {
  adminListApplicationCapabilities,
  adminListCapabilityDefinitions,
  adminSetApplicationCapability,
  adminUpsertCapabilityDefinition,
  type CapabilityDefinition,
} from "@/lib/capabilities.functions";
import type { ApplicationRow } from "@/types/database";

export const Route = createFileRoute("/admin/capabilities")({
  head: () => ({
    meta: [
      { title: "Admin · Capabilities — Core Platform" },
      { name: "description", content: "Register capabilities and toggle them per application." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminCapabilities />
    </ProtectedRoute>
  ),
});

function AdminCapabilities() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdminFn = useServerFn(getMyIsAdmin);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn() });
  useEffect(() => {
    if (adminQ.data && !adminQ.data.isAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [adminQ.data, navigate]);

  const appsQ = useQuery({
    queryKey: ["admin-apps"],
    queryFn: async () => {
      const { data, error } = await supabase.from("applications").select("*").order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ApplicationRow[];
    },
  });

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> {t("admin.common.back")}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.capabilities.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.capabilities.subtitle")}</p>

        <DefinitionsSection />
        <ApplicationCapabilitiesSection apps={appsQ.data ?? []} />
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DefinitionsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListCapabilityDefinitions);
  const upsertFn = useServerFn(adminUpsertCapabilityDefinition);
  const q = useQuery({ queryKey: ["admin-capability-definitions"], queryFn: () => listFn() });
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");

  const create = useMutation({
    mutationFn: () => upsertFn({ data: { key, label, enabled: true, archived: false, displayOrder: 0 } }),
    onSuccess: () => {
      toast.success(t("admin.capabilities.created"));
      setKey("");
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["admin-capability-definitions"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleEnabled = useMutation({
    mutationFn: (row: CapabilityDefinition) =>
      upsertFn({
        data: {
          id: row.id,
          key: row.key,
          label: row.label,
          description: row.description,
          displayOrder: row.displayOrder,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-capability-definitions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleArchived = useMutation({
    mutationFn: (row: CapabilityDefinition) =>
      upsertFn({
        data: {
          id: row.id,
          key: row.key,
          label: row.label,
          description: row.description,
          displayOrder: row.displayOrder,
          enabled: row.enabled,
          archived: !row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-capability-definitions"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.capabilities.definitionsTitle")}>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.common.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("admin.capabilities.keyPlaceholder")}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <label className="text-sm">
          {t("admin.common.label")}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          />
        </label>
        <button
          onClick={() => create.mutate()}
          disabled={!key.trim() || !label.trim() || create.isPending}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("admin.common.add")}
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className={`min-w-0 flex-1 truncate ${c.archived ? "text-gray-400 line-through" : ""}`}>
              <span className="font-medium">{c.label}</span>{" "}
              <span className="text-gray-400">({c.key})</span>
            </span>
            <div className="flex shrink-0 items-center gap-2">
              <AdminTogglePill enabled={c.enabled} disabled={c.archived} onClick={() => toggleEnabled.mutate(c)} />
              <button
                onClick={() => toggleArchived.mutate(c)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                title={c.archived ? t("admin.common.unarchive") : t("admin.common.archive")}
              >
                {c.archived ? <RotateCcw className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
                {c.archived ? t("admin.common.unarchive") : t("admin.common.archive")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ApplicationCapabilitiesSection({ apps }: { apps: ApplicationRow[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListApplicationCapabilities);
  const setFn = useServerFn(adminSetApplicationCapability);
  const [appId, setAppId] = useState("");
  const q = useQuery({
    queryKey: ["admin-app-capabilities", appId],
    enabled: !!appId,
    queryFn: () => listFn({ data: { appId } }),
  });

  const toggle = useMutation({
    mutationFn: (v: { capabilityKey: string; enabled: boolean }) =>
      setFn({ data: { appId, capabilityKey: v.capabilityKey, enabled: v.enabled } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-app-capabilities", appId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.capabilities.appCapabilitiesTitle")}>
      <label className="text-sm">
        {t("admin.common.application")}
        <select
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
        >
          <option value="">{t("admin.common.select")}</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {appId && (
        <ul className="mt-4 divide-y divide-gray-100">
          {(q.data ?? []).map((c) => (
            <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{c.label}</span>{" "}
                <span className="text-gray-400">({c.key})</span>
              </span>
              <AdminTogglePill
                enabled={c.appEnabled}
                onClick={() => toggle.mutate({ capabilityKey: c.key, enabled: !c.appEnabled })}
              />
            </li>
          ))}
          {(q.data ?? []).length === 0 && (
            <p className="py-2 text-sm text-gray-500">{t("admin.capabilities.noDefinitions")}</p>
          )}
        </ul>
      )}
    </Card>
  );
}
