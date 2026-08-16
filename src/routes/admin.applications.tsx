import { useState, useMemo, useRef, useEffect as useEffectR } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Plus, Archive, Save } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { supabase } from "@/integrations/supabase/client";
import {
  adminUpsertPlan,
  adminArchivePlan,
  getMyIsAdmin,
  adminCreateApplication,
  adminSetApplicationVisibility,
  adminUpdateAppSettings,
  adminUploadBrandingAsset,
} from "@/lib/admin.functions";
import { adminListRewardFulfillmentTypes } from "@/lib/rewards.functions";
import { adminUpsertShareInviteTemplate, getShareInviteConfig } from "@/lib/share-invite.functions";
import type { ApplicationRow, ApplicationVisibility, ProductType, SubscriptionPlanRow } from "@/types/database";

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
  const { t } = useTranslation();
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

  const fulfillmentTypesFn = useServerFn(adminListRewardFulfillmentTypes);
  const fulfillmentTypesQ = useQuery({
    queryKey: ["admin-reward-fulfillment-types"],
    queryFn: () => fulfillmentTypesFn(),
  });

  const upsert = useServerFn(adminUpsertPlan);
  const archive = useServerFn(adminArchivePlan);
  const createApp = useServerFn(adminCreateApplication);
  const setVisibility = useServerFn(adminSetApplicationVisibility);
  const updateSettings = useServerFn(adminUpdateAppSettings);

  const createAppMutation = useMutation({
    mutationFn: (v: NewAppPayload) => createApp({ data: v }),
    onSuccess: (row) => {
      toast.success(t("admin.applications.applicationCreated"));
      void qc.invalidateQueries({ queryKey: ["admin-apps"] });
      setAppId((row as { id: string }).id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const changeVisibility = useMutation({
    mutationFn: (v: { app_id: string; visibility: ApplicationVisibility }) => setVisibility({ data: v }),
    onSuccess: () => {
      toast.success(t("admin.applications.visibilityUpdated"));
      qc.invalidateQueries({ queryKey: ["admin-apps"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSettings = useMutation({
    mutationFn: (v: AppSettingsPayload & { app_id: string }) => updateSettings({ data: v }),
    onSuccess: () => {
      toast.success(t("admin.applications.settingsSaved"));
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
          product_type: plan.product_type ?? "subscription",
          grants_premium: plan.grants_premium ?? true,
          grants_benefit_key: plan.grants_benefit_key ?? null,
          requires_benefit_key: plan.requires_benefit_key ?? null,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.applications.productSaved"));
      qc.invalidateQueries({ queryKey: ["admin-plans", activeAppId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archivePlan = useMutation({
    mutationFn: (id: string) => archive({ data: { id } }),
    onSuccess: () => {
      toast.success(t("admin.applications.productDeactivated"));
      qc.invalidateQueries({ queryKey: ["admin-plans", activeAppId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!adminQ.data?.isAdmin) return null;

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-6 py-10">
      {/* Single shared definition for the .input class used throughout this
          page's forms (PlanForm, NewAppForm, AppSettings) -- hoisted here,
          on the page's one always-mounted top-level component, instead of
          being duplicated per-form, so no form depends on another having
          rendered first. */}
      <style>{`.input{width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:6px 10px;font-size:14px;background:#fff}`}</style>
      <div className="mx-auto max-w-5xl">
        <Link
          to="/admin"
          className="mb-4 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("admin.hub.title")}
        </Link>
        <h1 className="mb-6 text-2xl font-semibold text-gray-900">{t("admin.applications.title")}</h1>

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
              onSetVisibility={(visibility) => changeVisibility.mutate({ app_id: activeApp.id, visibility })}
              visibilityBusy={changeVisibility.isPending}
            />
            <ShareInviteSettings appId={activeApp.id} />

            <div>
              <h2 className="mb-1 text-sm font-semibold text-gray-900">{t("admin.applications.productsTitle")}</h2>
              <p className="mb-3 text-xs text-gray-500">{t("admin.applications.productsHint")}</p>
              <div className="space-y-4">
                {(plansQ.data ?? []).map((plan) => (
                  <PlanForm
                    key={plan.id}
                    initial={plan}
                    fulfillmentTypes={fulfillmentTypesQ.data ?? []}
                    onSave={(p) => savePlan.mutate({ ...p, id: plan.id })}
                    onArchive={() => archivePlan.mutate(plan.id)}
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
                    product_type: "subscription",
                    grants_premium: true,
                    features_bs: [],
                    features_en: [],
                    features_de: [],
                  }}
                  fulfillmentTypes={fulfillmentTypesQ.data ?? []}
                  isNew
                  onSave={(p) => savePlan.mutate(p)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function PlanForm({
  initial,
  fulfillmentTypes,
  isNew,
  onSave,
  onArchive,
}: {
  initial: Partial<SubscriptionPlanRow>;
  fulfillmentTypes: { key: string; label: string; enabled: boolean; archived: boolean }[];
  isNew?: boolean;
  onSave: (p: Partial<SubscriptionPlanRow>) => void;
  onArchive?: () => void;
}) {
  const { t } = useTranslation();
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
        <span className="text-sm font-semibold">{isNew ? t("admin.applications.newProduct") : p.name}</span>
        {onArchive && (
          <button
            onClick={onArchive}
            disabled={p.is_active === false}
            className="rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t("admin.applications.deactivateProduct")}
            title={p.is_active === false ? t("admin.applications.alreadyInactive") : t("admin.applications.deactivateHint")}
          >
            <Archive className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label={t("admin.applications.productType")}>
          <select
            className="input"
            value={p.product_type ?? "subscription"}
            onChange={(e) => setP({ ...p, product_type: e.target.value as ProductType })}
          >
            <option value="subscription">{t("admin.applications.typeSubscription")}</option>
            <option value="promotion">{t("admin.applications.typePromotion")}</option>
            <option value="one_time">{t("admin.applications.typeOneTime")}</option>
          </select>
        </Field>
        <Field label={t("admin.applications.name")}>
          <input
            className="input"
            value={p.name ?? ""}
            onChange={(e) => setP({ ...p, name: e.target.value })}
          />
        </Field>
        <Field label={t("admin.applications.durationMonths")}>
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
        <Field label={t("admin.applications.price")}>
          <input
            type="number"
            step="0.01"
            className="input"
            value={p.price ?? 0}
            onChange={(e) => setP({ ...p, price: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("admin.applications.currency")}>
          <input
            className="input"
            value={p.currency ?? "EUR"}
            onChange={(e) => setP({ ...p, currency: e.target.value })}
          />
        </Field>
        <Field label={t("admin.applications.grantsPremium")}>
          <label className="input flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={p.grants_premium ?? true}
              onChange={(e) => setP({ ...p, grants_premium: e.target.checked })}
            />
            {p.grants_premium ?? true
              ? t("admin.applications.grantsPremiumOn")
              : t("admin.applications.grantsPremiumOff")}
          </label>
        </Field>
        <Field label={t("admin.applications.grantsBenefit")} wide>
          <select
            className="input"
            value={p.grants_benefit_key ?? ""}
            onChange={(e) => setP({ ...p, grants_benefit_key: e.target.value || null })}
          >
            <option value="">{t("admin.applications.grantsBenefitNone")}</option>
            {fulfillmentTypes
              .filter((f) => f.enabled && !f.archived)
              .map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
          </select>
          <p className="mt-1 text-[11px] text-gray-400">{t("admin.applications.grantsBenefitHint")}</p>
        </Field>
        <Field label={t("admin.applications.requiresBenefit")} wide>
          <select
            className="input"
            value={p.requires_benefit_key ?? ""}
            onChange={(e) => setP({ ...p, requires_benefit_key: e.target.value || null })}
          >
            <option value="">{t("admin.applications.requiresBenefitNone")}</option>
            {fulfillmentTypes
              .filter((f) => f.enabled && !f.archived)
              .map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
          </select>
          <p className="mt-1 text-[11px] text-gray-400">{t("admin.applications.requiresBenefitHint")}</p>
          {p.requires_benefit_key && p.requires_benefit_key === p.grants_benefit_key && (
            <p className="mt-1 text-[11px] font-medium text-amber-600">
              {t("admin.applications.requiresBenefitSelfWarning")}
            </p>
          )}
          {p.requires_benefit_key && !p.grants_benefit_key && (
            <p className="mt-1 text-[11px] font-medium text-amber-600">
              {t("admin.applications.requiresBenefitNoGrantWarning")}
            </p>
          )}
        </Field>
        <Field label={t("admin.applications.stripeLink")} wide>
          <input
            className="input"
            placeholder="https://buy.stripe.com/..."
            value={p.stripe_payment_link ?? ""}
            onChange={(e) => setP({ ...p, stripe_payment_link: e.target.value })}
          />
        </Field>
        <Field label={t("admin.applications.paypalLink")} wide>
          <input
            className="input"
            placeholder="https://www.paypal.com/..."
            value={p.paypal_payment_link ?? ""}
            onChange={(e) => setP({ ...p, paypal_payment_link: e.target.value })}
          />
        </Field>
        <Field label={t("admin.applications.featuresBs")} wide>
          <textarea
            className="input min-h-[80px]"
            value={(p.features_bs ?? []).join("\n")}
            onChange={(e) => feat("bs", e.target.value)}
          />
        </Field>
        <Field label={t("admin.applications.featuresEn")} wide>
          <textarea
            className="input min-h-[80px]"
            value={(p.features_en ?? []).join("\n")}
            onChange={(e) => feat("en", e.target.value)}
          />
        </Field>
        <Field label={t("admin.applications.featuresDe")} wide>
          <textarea
            className="input min-h-[80px]"
            value={(p.features_de ?? []).join("\n")}
            onChange={(e) => feat("de", e.target.value)}
          />
        </Field>
        <Field label={t("admin.applications.active")}>
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
          {isNew ? t("admin.applications.create") : t("common.save")}
        </button>
      </div>
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
  const { t } = useTranslation();
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
      <h2 className="mb-4 text-sm font-semibold text-gray-900">{t("admin.applications.newApplicationTitle")}</h2>
      <p className="mb-3 text-xs text-gray-500">{t("admin.applications.newApplicationHint")}</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={t("admin.applications.name")}>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Muzika.ba"
          />
        </Field>
        <Field label={t("admin.applications.slug")}>
          <input
            className="input"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="muzika-ba"
          />
        </Field>
        <Field label={t("admin.applications.domain")}>
          <input
            className="input"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="muzika.ba"
          />
        </Field>
        <Field label={t("admin.applications.primaryColor")}>
          <input
            type="color"
            className="input h-9 p-1"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
          />
        </Field>
        <Field label={t("admin.applications.secondaryColor")}>
          <input
            type="color"
            className="input h-9 p-1"
            value={secondaryColor}
            onChange={(e) => setSecondaryColor(e.target.value)}
          />
        </Field>
        <Field label={t("admin.applications.googleClientId")} wide>
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
          {busy ? t("admin.applications.creating") : t("admin.applications.createApplication")}
        </button>
      </div>
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
  launch_date: string | null;
  default_language: "bs" | "en" | "de" | null;
};

function getVisibilityOptions(
  t: (key: string) => string,
): { value: ApplicationVisibility; label: string; hint: string }[] {
  return [
    { value: "draft", label: t("admin.applications.visibility.draft.label"), hint: t("admin.applications.visibility.draft.hint") },
    { value: "coming_soon", label: t("admin.applications.visibility.coming_soon.label"), hint: t("admin.applications.visibility.coming_soon.hint") },
    { value: "active", label: t("admin.applications.visibility.active.label"), hint: t("admin.applications.visibility.active.hint") },
    { value: "archived", label: t("admin.applications.visibility.archived.label"), hint: t("admin.applications.visibility.archived.hint") },
  ];
}

function AppSettings({
  app,
  onSave,
  busy,
  onSetVisibility,
  visibilityBusy,
}: {
  app: ApplicationRow;
  onSave: (v: AppSettingsPayload) => void;
  busy?: boolean;
  onSetVisibility: (visibility: ApplicationVisibility) => void;
  visibilityBusy?: boolean;
}) {
  const { t } = useTranslation();
  const VISIBILITY_OPTIONS = useMemo(() => getVisibilityOptions(t), [t]);
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
  const [launchDate, setLaunchDate] = useState(app.launch_date ? app.launch_date.slice(0, 16) : "");
  const [defaultLanguage, setDefaultLanguage] = useState<"" | "bs" | "en" | "de">(app.default_language ?? "");
  const [visibility, setVisibilityLocal] = useState<ApplicationVisibility>(app.visibility);
  const [uploading, setUploading] = useState<null | "logo" | "favicon" | "cover">(null);
  const uploadBrandingFn = useServerFn(adminUploadBrandingAsset);
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
    setLaunchDate(app.launch_date ? app.launch_date.slice(0, 16) : "");
    setDefaultLanguage(app.default_language ?? "");
    setVisibilityLocal(app.visibility);
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
    app.launch_date,
    app.default_language,
    app.visibility,
  ]);

  async function upload(kind: "logo" | "favicon" | "cover", file: File) {
    const maxSize = kind === "cover" ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(t("admin.applications.fileTooLarge", { max: maxSize / (1024 * 1024) }));
      return;
    }
    if (
      !["image/png", "image/jpeg", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"].includes(
        file.type,
      )
    ) {
      toast.error(t("admin.applications.unsupportedFormat"));
      return;
    }
    setUploading(kind);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("purpose", kind);
      form.append("appId", app.id);
      const result = await uploadBrandingFn({ data: form });
      if (kind === "logo") setLogoUrl(result.url);
      else if (kind === "favicon") setFaviconUrl(result.url);
      else setCoverImageUrl(result.url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  function submit() {
    if (!name.trim() || !slug.trim()) {
      toast.error(t("admin.applications.nameSlugRequired"));
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
      launch_date: launchDate ? new Date(launchDate).toISOString() : null,
      default_language: defaultLanguage || null,
    });
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <h2 className="mb-4 text-sm font-semibold text-gray-900">{t("admin.applications.appSettingsTitle")}</h2>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Field label={t("admin.applications.name")}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("admin.applications.slug")}>
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label={t("admin.applications.domain")}>
          <input className="input" value={domain} onChange={(e) => setDomain(e.target.value)} />
        </Field>
        <Field label={t("admin.applications.primaryColor")}>
          <input
            type="color"
            className="input h-9 p-1"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
          />
        </Field>
        <Field label={t("admin.applications.secondaryColor")}>
          <input
            type="color"
            className="input h-9 p-1"
            value={secondaryColor}
            onChange={(e) => setSecondaryColor(e.target.value)}
          />
        </Field>
        <Field label={t("admin.applications.sortOrder")}>
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
          <div className="mb-1 text-xs font-medium text-gray-600">{t("admin.applications.logo")}</div>
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
              {uploading === "logo" ? t("admin.applications.uploading") : t("admin.applications.changeLogo")}
            </button>
            <input
              ref={logoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload("logo", f);
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-400">{t("admin.applications.logoHint")}</p>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-gray-600">{t("admin.applications.favicon")}</div>
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
              {uploading === "favicon" ? t("admin.applications.uploading") : t("admin.applications.changeFavicon")}
            </button>
            <input
              ref={favRef}
              type="file"
              accept="image/png,image/x-icon,image/vnd.microsoft.icon"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload("favicon", f);
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-gray-400">{t("admin.applications.faviconHint")}</p>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-gray-600">{t("admin.applications.coverImage")}</div>
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
              {uploading === "cover" ? t("admin.applications.uploading") : t("admin.applications.changeCover")}
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
          <p className="mt-1 text-[11px] text-gray-400">{t("admin.applications.coverHint")}</p>
        </div>
      </div>

      <div className="mb-4">
        <div className="mb-2 text-xs font-medium text-gray-600">{t("admin.applications.preview")}</div>
        <BrandingPreview
          name={name}
          logoUrl={logoUrl}
          coverImageUrl={coverImageUrl || null}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
        />
      </div>

      <div className="mb-4">
        <Field label={t("admin.applications.googleClientId")}>
          <input
            className="input"
            value={googleClientId}
            onChange={(e) => setGoogleClientId(e.target.value)}
            placeholder="xxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
          />
        </Field>
        <p className="mt-1 text-[11px] text-gray-400">{t("admin.applications.googleClientIdHint")}</p>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Field label={t("admin.applications.launchDate")}>
          <input
            type="datetime-local"
            className="input"
            value={launchDate}
            onChange={(e) => setLaunchDate(e.target.value)}
          />
        </Field>
        <Field label={t("admin.applications.defaultLanguage")}>
          <select
            className="input"
            value={defaultLanguage}
            onChange={(e) => setDefaultLanguage(e.target.value as "" | "bs" | "en" | "de")}
          >
            <option value="">{t("admin.applications.noneFallThrough")}</option>
            <option value="bs">{t("admin.applications.langBosnian")}</option>
            <option value="en">{t("admin.applications.langEnglish")}</option>
            <option value="de">{t("admin.applications.langGerman")}</option>
          </select>
        </Field>
      </div>
      <p className="mb-4 -mt-2 text-[11px] text-gray-400">{t("admin.applications.languageHint")}</p>

      <div className="grid gap-3">
        <DescField label={t("admin.applications.descBs")} value={dBs} onChange={setDBs} />
        <DescField label={t("admin.applications.descEn")} value={dEn} onChange={setDEn} />
        <DescField label={t("admin.applications.descDe")} value={dDe} onChange={setDDe} />
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white hover:bg-[#1858cf] disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {busy ? t("admin.applications.saving") : t("admin.applications.saveSettings")}
        </button>
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="mb-2 text-xs font-medium text-gray-600">{t("admin.applications.visibilityTitle")}</div>
        <select
          className="input max-w-sm"
          value={visibility}
          onChange={(e) => setVisibilityLocal(e.target.value as ApplicationVisibility)}
        >
          {VISIBILITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-gray-500">
          {VISIBILITY_OPTIONS.find((o) => o.value === visibility)?.hint}
        </p>
        <p className="mt-1 text-xs text-gray-500">{t("admin.applications.visibilityImmutableHint")}</p>
        <button
          type="button"
          onClick={() => onSetVisibility(visibility)}
          disabled={visibilityBusy || visibility === app.visibility}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {visibilityBusy ? t("admin.applications.updatingVisibility") : t("admin.applications.updateVisibility")}
        </button>
      </div>
    </div>
  );
}

// Extends the existing Share & Invite / referral functionality
// (ShareAndInvite.tsx) with per-application templates. Share is
// application-focused (fixed title/description/URL); Invite is personal,
// filled client-side from {user_name}/{invite_link} placeholders. Every
// field is nullable -- left blank, ShareAndInvite.tsx falls back to a
// locale-aware default, it never breaks. See PROJECT_KNOWLEDGE.md -> Share
// Profile / Invite a Friend.
function ShareInviteSettings({ appId }: { appId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const getConfigFn = useServerFn(getShareInviteConfig);
  const upsertFn = useServerFn(adminUpsertShareInviteTemplate);

  const configQ = useQuery({
    queryKey: ["admin-share-invite-config", appId],
    queryFn: () => getConfigFn({ data: { appId } }),
  });

  const [shareTitle, setShareTitle] = useState("");
  const [shareDescription, setShareDescription] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [inviteTemplate, setInviteTemplate] = useState("");

  useEffectR(() => {
    setShareTitle(configQ.data?.shareTitle ?? "");
    setShareDescription(configQ.data?.shareDescription ?? "");
    setShareUrl(configQ.data?.shareUrl ?? "");
    setInviteTemplate(configQ.data?.inviteTemplate ?? "");
  }, [configQ.data]);

  const save = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          appId,
          shareTitle: shareTitle.trim() || null,
          shareDescription: shareDescription.trim() || null,
          shareUrl: shareUrl.trim() || null,
          inviteTemplate: inviteTemplate.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("admin.applications.shareInviteSaved"));
      qc.invalidateQueries({ queryKey: ["admin-share-invite-config", appId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">{t("admin.applications.shareInviteTitle")}</h2>
      <p className="mb-4 text-xs text-gray-500">
        {t("admin.applications.shareInviteHint")}{" "}
        <code className="rounded bg-gray-100 px-1">{"{user_name}"}</code>{" "}
        {t("admin.applications.and")}{" "}
        <code className="rounded bg-gray-100 px-1">{"{invite_link}"}</code>.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t("admin.applications.shareTitle")}>
          <input
            className="input"
            value={shareTitle}
            onChange={(e) => setShareTitle(e.target.value)}
            placeholder="Check this out"
          />
        </Field>
        <Field label={t("admin.applications.shareUrl")}>
          <input
            className="input"
            value={shareUrl}
            onChange={(e) => setShareUrl(e.target.value)}
            placeholder="https://your-app.example"
          />
        </Field>
        <Field label={t("admin.applications.shareDescription")} wide>
          <textarea
            className="input min-h-[60px]"
            value={shareDescription}
            onChange={(e) => setShareDescription(e.target.value)}
            placeholder="Discover this platform."
          />
        </Field>
        <Field label={t("admin.applications.inviteTemplate")} wide>
          <textarea
            className="input min-h-[60px]"
            value={inviteTemplate}
            onChange={(e) => setInviteTemplate(e.target.value)}
            placeholder="{user_name} invited you to join. Sign up here: {invite_link}"
          />
        </Field>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white hover:bg-[#1858cf] disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? t("common.saving") : t("common.save")}
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
  const { t } = useTranslation();
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
          {name || t("admin.applications.applicationNamePlaceholder")}
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
        className="min-h-[60px] w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D6BF3] focus-visible:ring-2 focus-visible:ring-[#1D6BF3]/40"
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
