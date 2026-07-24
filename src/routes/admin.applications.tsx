import { useState, useMemo, useRef, useEffect as useEffectR } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { ArrowLeft, Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import {
  adminUpsertPlan,
  adminDeletePlan,
  getMyIsAdmin,
  adminSetAppEnabled,
  adminUpdateAppSettings,
} from "@/lib/admin.functions";
import type { ApplicationRow, SubscriptionPlanRow } from "@/types/database";

export const Route = createFileRoute("/admin/applications")({
  head: () => ({
    meta: [
      { title: "Admin · Applications — Core Platform" },
      { name: "description", content: "Manage applications and subscription plans." },
      { property: "og:title", content: "Admin · Applications — Core Platform" },
      { property: "og:description", content: "Manage applications and subscription plans." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AdminApps />
    </ProtectedRoute>
  ),
});

function AdminApps() {
  const navigate = useNavigate();
  const isAdminFn = useServerFn(getMyIsAdmin);
  const adminQ = useQuery({ queryKey: ["is-admin"], queryFn: () => isAdminFn() });
  useEffect(() => {
    if (adminQ.data && !adminQ.data.isAdmin) void navigate({ to: "/dashboard", replace: true });
  }, [adminQ.data, navigate]);

  const [appId, setAppId] = useState<string | null>(null);
  const qc = useQueryClient();

  const appsQ = useQuery({
    queryKey: ["admin-apps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ApplicationRow[];
    },
  });

  const activeAppId = appId ?? appsQ.data?.[0]?.id ?? null;
  const activeApp = useMemo(
    () => appsQ.data?.find((a) => a.id === activeAppId) ?? null,
    [appsQ.data, activeAppId],
  );

  const plansQ = useQuery({
    queryKey: ["admin-plans", activeAppId],
    enabled: !!activeAppId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .eq("app_id", activeAppId!)
        .order("duration_months", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SubscriptionPlanRow[];
    },
  });

  const upsert = useServerFn(adminUpsertPlan);
  const del = useServerFn(adminDeletePlan);
  const setEnabled = useServerFn(adminSetAppEnabled);
  const updateSettings = useServerFn(adminUpdateAppSettings);

  const toggleEnabled = useMutation({
    mutationFn: (v: { app_id: string; is_enabled: boolean }) =>
      setEnabled({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin-apps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSettings = useMutation({
    mutationFn: (v: Parameters<typeof updateSettings>[0]["data"]) =>
      updateSettings({ data: v }),
    onSuccess: () => {
      toast.success("Postavke sačuvane");
      qc.invalidateQueries({ queryKey: ["admin-apps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePlan = useMutation({
    mutationFn: (plan: Partial<SubscriptionPlanRow>) =>
      upsert({
        data: {
          id: plan.id,
          app_id: activeAppId!,
          name: plan.name ?? "Premium",
          duration_months: (plan.duration_months ?? 12) as 1 | 3 | 6 | 12,
          price: Number(plan.price ?? 0),
          currency: plan.currency ?? "EUR",
          stripe_payment_link: plan.stripe_payment_link || null,
          paypal_payment_link: plan.paypal_payment_link || null,
          features_bs: plan.features_bs ?? [],
          features_en: plan.features_en ?? [],
          features_de: plan.features_de ?? [],
          is_active: plan.is_active ?? true,
        },
      }),
    onSuccess: () => {
      toast.success("Plan saved");
      qc.invalidateQueries({ queryKey: ["admin-plans", activeAppId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removePlan = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-plans", activeAppId] });
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
        <h1 className="mb-6 text-2xl font-semibold text-gray-900">Applications & Plans</h1>

        <div className="mb-6 flex flex-wrap gap-2">
          {(appsQ.data ?? []).map((a) => (
            <button
              key={a.id}
              onClick={() => setAppId(a.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                activeAppId === a.id
                  ? "text-white shadow-sm"
                  : "bg-white ring-1 ring-gray-200 hover:bg-gray-50"
              }`}
              style={activeAppId === a.id ? { backgroundColor: a.primary_color } : undefined}
            >
              {a.name}
            </button>
          ))}
        </div>

        {activeApp && (
          <div className="space-y-4">
            <AppSettings
              app={activeApp}
              onSave={(v) => saveSettings.mutate({ ...v, app_id: activeApp.id })}
              busy={saveSettings.isPending}
            />
            {(plansQ.data ?? []).map((plan) => (
              <PlanForm
                key={plan.id}
                initial={plan}
                onSave={(p) => savePlan.mutate({ ...p, id: plan.id })}
                onDelete={() => removePlan.mutate(plan.id)}
              />
            ))}
            <PlanForm
              key="new"
              initial={{
                name: "Premium 12m",
                duration_months: 12,
                price: 24,
                currency: "EUR",
                is_active: true,
                features_bs: [],
                features_en: [],
                features_de: [],
              }}
              isNew
              onSave={(p) => savePlan.mutate(p)}
            />
          </div>
        )}
      </div>
    </main>
  );
}

function PlanForm({
  initial,
  isNew,
  onSave,
  onDelete,
}: {
  initial: Partial<SubscriptionPlanRow>;
  isNew?: boolean;
  onSave: (p: Partial<SubscriptionPlanRow>) => void;
  onDelete?: () => void;
}) {
  const [p, setP] = useState<Partial<SubscriptionPlanRow>>(initial);

  function feat(l: "bs" | "en" | "de", v: string) {
    setP({ ...p, [`features_${l}`]: v.split("\n").map((x) => x.trim()).filter(Boolean) });
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">
          {isNew ? "New plan" : p.name}
        </span>
        {onDelete && (
          <button
            onClick={onDelete}
            className="rounded-lg p-2 text-red-500 hover:bg-red-50"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Name">
          <input
            className="input"
            value={p.name ?? ""}
            onChange={(e) => setP({ ...p, name: e.target.value })}
          />
        </Field>
        <Field label="Duration (months)">
          <select
            className="input"
            value={p.duration_months ?? 12}
            onChange={(e) =>
              setP({ ...p, duration_months: Number(e.target.value) as 1 | 3 | 6 | 12 })
            }
          >
            {[1, 3, 6, 12].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price">
          <input
            type="number"
            step="0.01"
            className="input"
            value={p.price ?? 0}
            onChange={(e) => setP({ ...p, price: Number(e.target.value) })}
          />
        </Field>
        <Field label="Currency">
          <input
            className="input"
            value={p.currency ?? "EUR"}
            onChange={(e) => setP({ ...p, currency: e.target.value })}
          />
        </Field>
        <Field label="Stripe payment link" wide>
          <input
            className="input"
            placeholder="https://buy.stripe.com/..."
            value={p.stripe_payment_link ?? ""}
            onChange={(e) => setP({ ...p, stripe_payment_link: e.target.value })}
          />
        </Field>
        <Field label="PayPal payment link" wide>
          <input
            className="input"
            placeholder="https://www.paypal.com/..."
            value={p.paypal_payment_link ?? ""}
            onChange={(e) => setP({ ...p, paypal_payment_link: e.target.value })}
          />
        </Field>
        <Field label="Features BS (one per line)" wide>
          <textarea
            className="input min-h-[80px]"
            value={(p.features_bs ?? []).join("\n")}
            onChange={(e) => feat("bs", e.target.value)}
          />
        </Field>
        <Field label="Features EN (one per line)" wide>
          <textarea
            className="input min-h-[80px]"
            value={(p.features_en ?? []).join("\n")}
            onChange={(e) => feat("en", e.target.value)}
          />
        </Field>
        <Field label="Features DE (one per line)" wide>
          <textarea
            className="input min-h-[80px]"
            value={(p.features_de ?? []).join("\n")}
            onChange={(e) => feat("de", e.target.value)}
          />
        </Field>
        <Field label="Active">
          <input
            type="checkbox"
            checked={p.is_active ?? true}
            onChange={(e) => setP({ ...p, is_active: e.target.checked })}
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => onSave(p)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white hover:bg-[#1858cf]"
        >
          {isNew ? <Plus className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {isNew ? "Create" : "Save"}
        </button>
      </div>
      <style>{`.input{width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font-size:14px;background:#fff}`}</style>
    </div>
  );
}

function AppSettings({
  app,
  onToggle,
  busy,
}: {
  app: ApplicationRow;
  onToggle: (v: boolean) => void;
  busy?: boolean;
}) {
  const enabled = app.is_enabled !== false;
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">App Settings</h2>
      <div className="mb-3 text-sm text-gray-700">
        Status:{" "}
        <span className={enabled ? "font-medium text-green-700" : "font-medium text-gray-500"}>
          {enabled ? "Aktivna" : "Uskoro dostupno"}
        </span>
      </div>
      <label className="inline-flex cursor-pointer items-center gap-3">
        <span className="relative inline-block h-6 w-11">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={enabled}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="absolute inset-0 rounded-full bg-gray-300 transition peer-checked:bg-[#1D6BF3]" />
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </span>
        <span className="text-sm text-gray-800">
          {enabled ? "Aplikacija aktivna" : "Aplikacija neaktivna"}
        </span>
      </label>
      <p className="mt-3 text-xs text-gray-500">
        Kada je neaktivna, korisnici vide samo "Uskoro dostupno" badge.
      </p>
    </div>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "md:col-span-4" : ""}`}>
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}