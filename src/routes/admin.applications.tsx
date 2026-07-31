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
  adminCreateApplication,
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
  const createApp = useServerFn(adminCreateApplication);
  const setEnabled = useServerFn(adminSetAppEnabled);
  const updateSettings = useServerFn(adminUpdateAppSettings);

  const createAppMutation = useMutation({
    mutationFn: (v: NewAppPayload) => createApp({ data: v }),
    onSuccess: (row) => {
      toast.success("Application created");
      void qc.invalidateQueries({ queryKey: ["admin-apps"] });
      setAppId((row as { id: string }).id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleEnabled = useMutation({
    mutationFn: (v: { app_id: string; is_enabled: boolean }) => setEnabled({ data: v }),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["admin-apps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSettings = useMutation({
    mutationFn: (v: AppSettingsPayload & { app_id: string }) => updateSettings({ data: v }),
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
              <span className="inline-flex items-center gap-2">
                {a.logo_url ? (
                  <img
                    src={a.logo_url}
                    alt=""
                    width={24}
                    height={24}
                    className="h-6 w-6 rounded object-cover"
                  />
                ) : (
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-semibold text-white"
                    style={{ backgroundColor: a.primary_color }}
                  >
                    {a.name.slice(0, 1)}
                  </span>
                )}
                {a.name}
              </span>
            </button>
          ))}
        </div>

        <div className="mb-6">
          <NewAppForm
            onCreate={(v) => createAppMutation.mutate(v)}
            busy={createAppMutation.isPending}
          />
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
    setP({
      ...p,
      [`features_${l}`]: v
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
    });
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">{isNew ? "New plan" : p.name}</span>
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

type NewAppPayload = {
  name: string;
  slug: string;
  domain: string | null;
  primary_color: string;
  secondary_color: string;
  google_client_id: string | null;
};

function NewAppForm({ onCreate, busy }: { onCreate: (v: NewAppPayload) => void; busy?: boolean }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [domain, setDomain] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#1D6BF3");
  const [secondaryColor, setSecondaryColor] = useState("#6366F1");
  const [googleClientId, setGoogleClientId] = useState("");

  function submit() {
    if (!name.trim() || !slug.trim()) return;
    onCreate({
      name: name.trim(),
      slug: slug.trim(),
      domain: domain.trim() || null,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      google_client_id: googleClientId.trim() || null,
    });
    setName("");
    setSlug("");
    setDomain("");
    setGoogleClientId("");
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <h2 className="mb-4 text-sm font-semibold text-gray-900">New Application</h2>
      <p className="mb-3 text-xs text-gray-500">
        Registers a new application. It automatically gets every Core capability (auth, profiles,
        billing, notifications, permissions, audit log) with no further setup. It's created disabled
        — add plans and branding below, then switch it on in App Settings once it's ready.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Muzika.ba"
          />
        </Field>
        <Field label="Slug">
          <input
            className="input"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="muzika-ba"
          />
        </Field>
        <Field label="Domain">
          <input
            className="input"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="muzika.ba"
          />
        </Field>
        <Field label="Primary color">
          <input
            type="color"
            className="input h-9 p-1"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
          />
        </Field>
        <Field label="Secondary color">
          <input
            type="color"
            className="input h-9 p-1"
            value={secondaryColor}
            onChange={(e) => setSecondaryColor(e.target.value)}
          />
        </Field>
        <Field label="Google Client ID" wide>
          <input
            className="input"
            value={googleClientId}
            onChange={(e) => setGoogleClientId(e.target.value)}
            placeholder="xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
          />
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white hover:bg-[#1858cf] disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          {busy ? "Creating…" : "Create application"}
        </button>
      </div>
      <style>{`.input{width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font-size:14px;background:#fff}`}</style>
    </div>
  );
}

type AppSettingsPayload = {
  name: string;
  slug: string;
  domain: string | null;
  primary_color: string;
  secondary_color: string;
  cover_image_url: string | null;
  sort_order: number;
  logo_url: string | null;
  favicon_url: string | null;
  google_client_id: string | null;
  short_description_bs: string | null;
  short_description_en: string | null;
  short_description_de: string | null;
  is_enabled: boolean;
};

function AppSettings({
  app,
  onSave,
  busy,
}: {
  app: ApplicationRow;
  onSave: (v: AppSettingsPayload) => void;
  busy?: boolean;
}) {
  const [name, setName] = useState(app.name);
  const [slug, setSlug] = useState(app.slug);
  const [domain, setDomain] = useState(app.domain ?? "");
  const [primaryColor, setPrimaryColor] = useState(app.primary_color);
  const [secondaryColor, setSecondaryColor] = useState(app.secondary_color);
  const [coverImageUrl, setCoverImageUrl] = useState(app.cover_image_url ?? "");
  const [sortOrder, setSortOrder] = useState(app.sort_order);
  const [logoUrl, setLogoUrl] = useState<string | null>(app.logo_url);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(app.favicon_url);
  const [googleClientId, setGoogleClientId] = useState(app.google_client_id ?? "");
  const [dBs, setDBs] = useState(app.short_description_bs ?? "");
  const [dEn, setDEn] = useState(app.short_description_en ?? "");
  const [dDe, setDDe] = useState(app.short_description_de ?? "");
  const [enabled, setEnabled] = useState(app.is_enabled !== false);
  const [uploading, setUploading] = useState<null | "logo" | "favicon" | "cover">(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const favRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffectR(() => {
    setName(app.name);
    setSlug(app.slug);
    setDomain(app.domain ?? "");
    setPrimaryColor(app.primary_color);
    setSecondaryColor(app.secondary_color);
    setCoverImageUrl(app.cover_image_url ?? "");
    setSortOrder(app.sort_order);
    setLogoUrl(app.logo_url);
    setFaviconUrl(app.favicon_url);
    setGoogleClientId(app.google_client_id ?? "");
    setDBs(app.short_description_bs ?? "");
    setDEn(app.short_description_en ?? "");
    setDDe(app.short_description_de ?? "");
    setEnabled(app.is_enabled !== false);
  }, [
    app.id,
    app.name,
    app.slug,
    app.domain,
    app.primary_color,
    app.secondary_color,
    app.cover_image_url,
    app.sort_order,
    app.logo_url,
    app.favicon_url,
    app.google_client_id,
    app.short_description_bs,
    app.short_description_en,
    app.short_description_de,
    app.is_enabled,
  ]);

  async function upload(kind: "logo" | "favicon" | "cover", file: File) {
    const maxSize = kind === "cover" ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`Fajl je prevelik (max ${maxSize / (1024 * 1024)}MB)`);
      return;
    }
    if (
      ![
        "image/png",
        "image/svg+xml",
        "image/jpeg",
        "image/webp",
        "image/x-icon",
        "image/vnd.microsoft.icon",
      ].includes(file.type)
    ) {
      toast.error("Nepodržan format");
      return;
    }
    setUploading(kind);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `applications/${app.slug}/${kind}.${ext}`;
      const { error } = await supabase.storage
        .from("core")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from("core").getPublicUrl(path);
      if (kind === "logo") setLogoUrl(publicUrl);
      else if (kind === "favicon") setFaviconUrl(publicUrl);
      else setCoverImageUrl(publicUrl);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  function submit() {
    if (!name.trim() || !slug.trim()) {
      toast.error("Name and slug are required");
      return;
    }
    onSave({
      name: name.trim(),
      slug: slug.trim(),
      domain: domain.trim() || null,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
      cover_image_url: coverImageUrl.trim() || null,
      sort_order: sortOrder,
      logo_url: logoUrl,
      favicon_url: faviconUrl,
      google_client_id: googleClientId.trim() || null,
      short_description_bs: dBs.trim() || null,
      short_description_en: dEn.trim() || null,
      short_description_de: dDe.trim() || null,
      is_enabled: enabled,
    });
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <h2 className="mb-4 text-sm font-semibold text-gray-900">App Settings</h2>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Slug">
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="Domain">
          <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} />
        </Field>
        <Field label="Primary color">
          <input
            type="color"
            className="input h-9 p-1"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
          />
        </Field>
        <Field label="Secondary color">
          <input
            type="color"
            className="input h-9 p-1"
            value={secondaryColor}
            onChange={(e) => setSecondaryColor(e.target.value)}
          />
        </Field>
        <Field label="Sort order">
          <input
            type="number"
            className="input"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </Field>
      </div>

      <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:gap-8">
        <div>
          <div className="mb-1 text-xs font-medium text-gray-600">Logo</div>
          <div className="flex items-center gap-3">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-200">
              {logoUrl ? (
                <img src={logoUrl} alt="logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-gray-400">—</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => logoRef.current?.click()}
              disabled={uploading === "logo"}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {uploading === "logo" ? "Uploading…" : "Promijeni logo"}
            </button>
            <input
              ref={logoRef}
              type="file"
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload("logo", f);
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-400">PNG, SVG, JPG · max 2MB</p>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-gray-600">Favicon</div>
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded bg-gray-50 ring-1 ring-gray-200">
              {faviconUrl ? (
                <img src={faviconUrl} alt="favicon" className="h-full w-full object-contain" />
              ) : (
                <span className="text-[10px] text-gray-400">—</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => favRef.current?.click()}
              disabled={uploading === "favicon"}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {uploading === "favicon" ? "Uploading…" : "Promijeni favicon"}
            </button>
            <input
              ref={favRef}
              type="file"
              accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload("favicon", f);
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-400">PNG, SVG, ICO · max 2MB</p>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-gray-600">Cover Image</div>
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-32 items-center justify-center overflow-hidden rounded-xl bg-gray-50 ring-1 ring-gray-200">
              {coverImageUrl ? (
                <img src={coverImageUrl} alt="cover" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-gray-400">—</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => coverRef.current?.click()}
              disabled={uploading === "cover"}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {uploading === "cover" ? "Uploading…" : "Promijeni cover"}
            </button>
            <input
              ref={coverRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload("cover", f);
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-400">PNG, JPG, WEBP · max 5MB</p>
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-2 text-xs font-medium text-gray-600">Preview</div>
        <BrandingPreview
          name={name}
          logoUrl={logoUrl}
          coverImageUrl={coverImageUrl || null}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
        />
      </div>

      <div className="mb-4">
        <Field label="Google Client ID">
          <input
            className="input"
            value={googleClientId}
            onChange={(e) => setGoogleClientId(e.target.value)}
            placeholder="xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
          />
        </Field>
        <p className="mt-1 text-[11px] text-gray-400">
          This application's own Google Cloud OAuth Client ID (its own consent-screen name/logo).
          Not secret. The Client Secret is never stored here -- it stays only in Supabase's Auth
          provider configuration.
        </p>
      </div>

      <div className="grid gap-3">
        <DescField label="Kratki opis (BS)" value={dBs} onChange={setDBs} />
        <DescField label="Kratki opis (EN)" value={dEn} onChange={setDEn} />
        <DescField label="Kratki opis (DE)" value={dDe} onChange={setDDe} />
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="mb-2 text-xs font-medium text-gray-600">Status</div>
        <label className="inline-flex cursor-pointer items-center gap-3">
          <span className="relative inline-block h-6 w-11">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="absolute inset-0 rounded-full bg-gray-300 transition peer-checked:bg-[#1D6BF3]" />
            <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
          </span>
          <span className="text-sm text-gray-800">
            {enabled ? "Aplikacija aktivna" : "Aplikacija neaktivna"}
          </span>
        </label>
        <p className="mt-2 text-xs text-gray-500">
          Kada je neaktivna, korisnici vide samo "Uskoro dostupno" badge.
        </p>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white hover:bg-[#1858cf] disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {busy ? "Spremam…" : "Sačuvaj postavke"}
        </button>
      </div>
    </div>
  );
}

// Combined live preview of an application's branding -- cover, logo, and
// both colors together -- so an admin can see the result before saving.
// Presentational only; mirrors the same cover/logo treatment
// ProfileCard.tsx uses, not a new visual language.
function BrandingPreview({
  name,
  logoUrl,
  coverImageUrl,
  primaryColor,
  secondaryColor,
}: {
  name: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}) {
  return (
    <div className="w-full max-w-xs overflow-hidden rounded-2xl ring-1 ring-gray-200">
      <div
        className="relative h-20 bg-cover bg-center"
        style={
          coverImageUrl
            ? { backgroundImage: `url(${coverImageUrl})` }
            : { background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)` }
        }
      >
        {logoUrl && (
          <div className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center overflow-hidden rounded-md bg-white/90 shadow">
            <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 bg-white p-3">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: primaryColor }} />
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: secondaryColor }} />
        <span className="truncate text-xs font-medium text-gray-700">
          {name || "Application name"}
        </span>
      </div>
    </div>
  );
}

function DescField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const max = 160;
  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <span className={`text-[11px] ${value.length > max ? "text-red-500" : "text-gray-400"}`}>
          {value.length}/{max}
        </span>
      </div>
      <textarea
        value={value}
        maxLength={max}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[60px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D6BF3]"
      />
    </label>
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
