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
import { ArrowLeft, Plus } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
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
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard Widgets</h1>
        <p className="mt-1 text-sm text-gray-500">
          Which sections of the user dashboard are enabled, globally or per application.
        </p>

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
      toast.success("Widget created");
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
    <Card title="Widget definitions">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Key
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="e.g. leaderboard"
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          Label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          Requires capability
          <select
            value={requiresCapability}
            onChange={(e) => setRequiresCapability(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          >
            <option value="">None</option>
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
          className="inline-flex items-center gap-1 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>
      <ul className="mt-4 divide-y divide-gray-100">
        {(q.data ?? []).map((w) => (
          <li key={w.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              <span className="font-medium">{w.label}</span>{" "}
              <span className="text-gray-400">({w.key})</span>
              {w.requiresCapability && (
                <span className="ml-2 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                  requires: {w.requiresCapability}
                </span>
              )}
            </span>
            <button
              onClick={() => toggle.mutate(w)}
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                w.enabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
              }`}
            >
              {w.enabled ? "Enabled" : "Disabled"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ApplicationSettingsSection({ apps }: { apps: ApplicationRow[] }) {
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
    <Card title="Per-application overrides">
      <label className="text-sm">
        Application
        <select
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          className="mt-1 block rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
        >
          <option value="">Select...</option>
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
            <li key={w.key} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className="font-medium">{w.label}</span>{" "}
                <span className="text-gray-400">({w.key})</span>
              </span>
              <button
                onClick={() => toggle.mutate({ widgetKey: w.key, enabled: !w.appEnabled })}
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  w.appEnabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
                }`}
              >
                {w.appEnabled ? "Enabled" : "Disabled"}
              </button>
            </li>
          ))}
          {(q.data ?? []).length === 0 && (
            <p className="py-2 text-sm text-gray-500">No widget definitions yet.</p>
          )}
        </ul>
      )}
    </Card>
  );
}
