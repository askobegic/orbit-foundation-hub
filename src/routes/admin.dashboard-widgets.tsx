// Priority 8.7 (C-1): Admin UI for Dashboard Widget Modularity (Priority 8.2).
//
// dashboard_widgets / dashboard_widget_settings were fully implemented
// (src/lib/dashboard-widgets.functions.ts) but had no admin surface -- every
// widget registration and per-application override required SQL. Same
// registry + per-application-override shape as /admin/capabilities,
// reused deliberately (see dashboard-widgets.functions.ts's own header).
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminTogglePill } from "@/components/admin/AdminTogglePill";
import { supabase } from "@/integrations/supabase/client";
import { getMyIsAdmin } from "@/lib/admin.functions";
import { adminListCapabilityDefinitions } from "@/lib/capabilities.functions";
import {
  adminListDashboardWidgets,
  adminListDashboardWidgetSettings,
  adminSetDashboardWidgetAppSetting,
  adminUpsertDashboardWidget,
  type DashboardWidgetDefinition,
} from "@/lib/dashboard-widgets.functions";
import type { ApplicationRow } from "@/types/database";

export const Route = createFileRoute("/admin/dashboard-widgets")({
  head: () => ({
    meta: [
      { title: "Admin · Dashboard Widgets — Core Platform" },
      { name: "description", content: "Register dashboard widgets and toggle them per application." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminDashboardWidgets />
    </ProtectedRoute>
  ),
});

function AdminDashboardWidgets() {
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
        <h1 className="text-2xl font-semibold text-gray-900">{t("admin.dashboardWidgets.title")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("admin.dashboardWidgets.subtitle")}</p>

        <DefinitionsSection />
        <ApplicationSettingsSection apps={appsQ.data ?? []} />
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
  const listFn = useServerFn(adminListDashboardWidgets);
  const upsertFn = useServerFn(adminUpsertDashboardWidget);
  const listCapabilitiesFn = useServerFn(adminListCapabilityDefinitions);
  const q = useQuery({ queryKey: ["admin-dashboard-widgets"], queryFn: () => listFn() });
  const capabilitiesQ = useQuery({
    queryKey: ["admin-capability-definitions"],
    queryFn: () => listCapabilitiesFn(),
  });
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [requiresCapability, setRequiresCapability] = useState("");

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          key,
          label,
          requiresCapability: requiresCapability || null,
          enabled: true,
          archived: false,
          displayOrder: 0,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.dashboardWidgets.created"));
      setKey("");
      setLabel("");
      setRequiresCapability("");
      void qc.invalidateQueries({ queryKey: ["admin-dashboard-widgets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (row: DashboardWidgetDefinition) =>
      upsertFn({
        data: {
          id: row.id,
          key: row.key,
          label: row.label,
          description: row.description,
          requiresCapability: row.requiresCapability,
          displayOrder: row.displayOrder,
          enabled: !row.enabled,
          archived: row.archived,
        },
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-dashboard-widgets"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.dashboardWidgets.definitionsTitle")}>
      <div className="grid grid-cols-1 items-end gap-2 sm:flex sm:flex-wrap">
        <label className="text-sm">
          {t("admin.common.key")}
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("admin.dashboardWidgets.keyPlaceholder")}
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
        <label className="text-sm">
          {t("admin.dashboardWidgets.requiresCapability")}
          <select
            value={requiresCapability}
            onChange={(e) => setRequiresCapability(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm sm:w-auto"
          >
            <option value="">{t("admin.common.none")}</option>
            {(capabilitiesQ.data ?? []).map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
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
        {(q.data ?? []).map((w) => (
          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{w.label}</span>{" "}
              <span className="text-gray-400">({w.key})</span>
              {w.requiresCapability && (
                <span className="ml-2 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                  {t("admin.dashboardWidgets.requiresBadge", { capability: w.requiresCapability })}
                </span>
              )}
            </span>
            <AdminTogglePill enabled={w.enabled} onClick={() => toggle.mutate(w)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ApplicationSettingsSection({ apps }: { apps: ApplicationRow[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const listFn = useServerFn(adminListDashboardWidgetSettings);
  const setFn = useServerFn(adminSetDashboardWidgetAppSetting);
  const [appId, setAppId] = useState("");
  const q = useQuery({
    queryKey: ["admin-dashboard-widget-settings", appId],
    enabled: !!appId,
    queryFn: () => listFn({ data: { appId } }),
  });

  const toggle = useMutation({
    mutationFn: (v: { widgetKey: string; enabled: boolean }) =>
      setFn({ data: { appId, widgetKey: v.widgetKey, enabled: v.enabled } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-dashboard-widget-settings", appId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card title={t("admin.dashboardWidgets.overridesTitle")}>
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
          {(q.data ?? []).map((w) => (
            <li key={w.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{w.label}</span>{" "}
                <span className="text-gray-400">({w.key})</span>
              </span>
              <AdminTogglePill
                enabled={w.appEnabled}
                onClick={() => toggle.mutate({ widgetKey: w.key, enabled: !w.appEnabled })}
              />
            </li>
          ))}
          {(q.data ?? []).length === 0 && (
            <p className="py-2 text-sm text-gray-500">{t("admin.dashboardWidgets.noWidgets")}</p>
          )}
        </ul>
      )}
    </Card>
  );
}
