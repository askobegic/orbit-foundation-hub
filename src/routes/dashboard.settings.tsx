import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save, Download, Trash2, Loader2 } from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardMobileNav } from "@/components/dashboard/DashboardNav";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { updateUserSettings } from "@/lib/notifications.functions";
import { exportUserData, deleteMyAccount } from "@/lib/gdpr.functions";
import { supabase } from "@/integrations/supabase/client";
import type { ApplicationRow, NotificationCategory } from "@/types/database";

// CORE Notification & User Engagement System: the full notification
// category vocabulary (notifications.category), offered here as
// per-category email opt-outs -- only shown once the blanket "Email
// notifications" toggle above is on.
const EMAIL_CATEGORIES: NotificationCategory[] = [
  "information",
  "reward",
  "premium",
  "offer",
  "message",
  "inactivity",
  "warning",
  "system",
];

export const Route = createFileRoute("/dashboard/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Core Platform" },
      { name: "description", content: "Manage your language and notification preferences." },
      { property: "og:title", content: "Settings — Core Platform" },
      { property: "og:description", content: "Manage your language and notification preferences." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <SettingsPage />
    </ProtectedRoute>
  ),
});

function SettingsPage() {
  const { t } = useTranslation();
  const { user, profile, refreshProfile, signOut } = useAuth();
  const { setLanguage } = useLanguage();
  const navigate = useNavigate();
  const save = useServerFn(updateUserSettings);
  const runExport = useServerFn(exportUserData);
  const runDelete = useServerFn(deleteMyAccount);

  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const [lang, setLang] = useState<"bs" | "en" | "de">("bs");
  const [disabledEmailCategories, setDisabledEmailCategories] = useState<string[]>([]);
  const [email, setEmail] = useState(true);
  const [inApp, setInApp] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [saving, setSaving] = useState(false);

  type AppSettingRow = {
    app: ApplicationRow;
    is_visible: boolean;
    is_contactable: boolean;
  };
  const [appSettings, setAppSettings] = useState<AppSettingRow[]>([]);
  const [savingApps, setSavingApps] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [{ data: apps }, { data: settings }] = await Promise.all([
        supabase.from("applications").select("*").eq("visibility", "active").order("sort_order"),
        supabase
          .from("user_app_settings")
          .select("app_id, is_visible, is_contactable")
          .eq("user_id", user.id),
      ]);
      const map = new Map(
        (settings ?? []).map(
          (s: { app_id: string; is_visible: boolean; is_contactable: boolean }) => [s.app_id, s],
        ),
      );
      const merged = ((apps as ApplicationRow[] | null) ?? []).map((app) => {
        const s = map.get(app.id);
        return {
          app,
          is_visible: s?.is_visible ?? true,
          is_contactable: s?.is_contactable ?? true,
        };
      });
      setAppSettings(merged);
    })();
  }, [user]);

  async function updateAppSetting(
    appId: string,
    patch: { is_visible?: boolean; is_contactable?: boolean },
  ) {
    if (!user) return;
    // Derive the write payload from the functional updater's own `prev`,
    // not from the outer `appSettings` closure -- the closure can be stale
    // if two toggles fire in quick succession (see PROJECT_AUDIT.md -> DA-5).
    let payload: {
      user_id: string;
      app_id: string;
      is_visible: boolean;
      is_contactable: boolean;
    } | null = null;
    setAppSettings((prev) => {
      const next = prev.map((r) => (r.app.id === appId ? { ...r, ...patch } : r));
      const row = next.find((r) => r.app.id === appId);
      payload = {
        user_id: user.id,
        app_id: appId,
        is_visible: row?.is_visible ?? true,
        is_contactable: row?.is_contactable ?? true,
      };
      return next;
    });
    setSavingApps((s) => ({ ...s, [appId]: true }));
    try {
      const { error } = await supabase
        .from("user_app_settings")
        .upsert(payload!, { onConflict: "user_id,app_id" });
      if (error) throw error;
      toast.success(t("settings.saved"));
    } catch {
      toast.error(t("common.errorGeneric"));
    } finally {
      setSavingApps((s) => ({ ...s, [appId]: false }));
    }
  }

  useEffect(() => {
    if (!profile) return;
    setLang((profile.language ?? "bs") as "bs" | "en" | "de");
    setEmail(profile.notify_email ?? true);
    setInApp(profile.notify_in_app ?? true);
    setMarketing(profile.notify_marketing ?? false);
    setDisabledEmailCategories(profile.email_disabled_categories ?? []);
  }, [profile]);

  function toggleEmailCategory(category: string, enabled: boolean) {
    setDisabledEmailCategories((prev) =>
      enabled ? prev.filter((c) => c !== category) : [...new Set([...prev, category])],
    );
  }

  async function handleSave() {
    setSaving(true);
    try {
      await save({
        data: {
          language: lang,
          notify_email: email,
          notify_in_app: inApp,
          notify_marketing: marketing,
          email_disabled_categories: disabledEmailCategories,
        },
      });
      await setLanguage(lang);
      await refreshProfile();
      toast.success(t("settings.saved"));
    } catch {
      toast.error(t("common.errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const data = await runExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const username = (profile?.username || profile?.email?.split("@")[0] || "user").replace(
        /[^a-z0-9-]/gi,
        "-",
      );
      a.href = url;
      a.download = `${t("privacy.exportFileName")}-${username}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t("privacy.exportReady"));
    } catch {
      toast.error(t("common.errorGeneric"));
    } finally {
      setExporting(false);
    }
  }

  const deleteConfirmWord = t("privacy.deleteConfirmWord");

  async function handleDelete() {
    if (deleteConfirm !== deleteConfirmWord) {
      toast.error(t("privacy.deleteMismatch", { word: deleteConfirmWord }));
      return;
    }
    setDeleting(true);
    try {
      await runDelete();
      await signOut();
      toast.success(t("privacy.deleteDone"));
      navigate({ to: "/login" });
    } catch {
      toast.error(t("common.errorGeneric"));
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA] px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <DashboardMobileNav />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{t("settings.title")}</h1>
            <p className="text-sm text-gray-500">{t("settings.subtitle")}</p>
          </div>
        </div>

        <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">{t("settings.language")}</h2>
          <div className="flex gap-2">
            {(["bs", "en", "de"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                  lang === code
                    ? "border-[#1D6BF3] bg-[#1D6BF3]/10 text-[#1D6BF3]"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
        </section>

        <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">
            {t("settings.notificationPrefs")}
          </h2>
          <div className="divide-y divide-gray-100">
            <Row
              label={t("settings.notifyInApp")}
              hint={t("settings.notifyInAppHint")}
              value={inApp}
              onChange={setInApp}
            />
            <Row
              label={t("settings.notifyEmail")}
              hint={t("settings.notifyEmailHint")}
              value={email}
              onChange={setEmail}
            />
            <Row
              label={t("settings.notifyMarketing")}
              hint={t("settings.notifyMarketingHint")}
              value={marketing}
              onChange={setMarketing}
            />
          </div>
        </section>

        {email && (
          <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <h2 className="mb-1 text-sm font-semibold text-gray-900">
              {t("settings.emailCategories")}
            </h2>
            <p className="mb-4 text-xs text-gray-500">{t("settings.emailCategoriesHint")}</p>
            <div className="divide-y divide-gray-100">
              {EMAIL_CATEGORIES.map((category) => (
                <Row
                  key={category}
                  label={t(`settings.emailCategory.${category}`)}
                  value={!disabledEmailCategories.includes(category)}
                  onChange={(enabled) => toggleEmailCategory(category, enabled)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="mb-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">
            {t("settings.appVisibility")}
          </h2>
          <p className="mb-4 text-xs text-gray-500">{t("settings.appVisibilityHint")}</p>
          <div className="divide-y divide-gray-100">
            {appSettings.length === 0 && (
              <p className="py-4 text-sm text-gray-500">{t("common.loading")}</p>
            )}
            {appSettings.map((row) => (
              <div
                key={row.app.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg text-xs font-semibold text-white"
                    style={{ background: row.app.primary_color ?? "#1D6BF3" }}
                  >
                    {row.app.logo_url ? (
                      <img
                        src={row.app.logo_url}
                        alt={row.app.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      row.app.name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{row.app.name}</p>
                    <p className="text-xs text-gray-500">{row.app.domain}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                  <MiniToggle
                    label={t("settings.visibleInDirectory")}
                    value={row.is_visible}
                    onChange={(v) => void updateAppSetting(row.app.id, { is_visible: v })}
                    disabled={savingApps[row.app.id]}
                  />
                  <MiniToggle
                    label={t("settings.canBeContacted")}
                    value={row.is_contactable}
                    onChange={(v) => void updateAppSetting(row.app.id, { is_contactable: v })}
                    disabled={savingApps[row.app.id]}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1D6BF3] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1758C6] disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? t("common.saving") : t("common.save")}
        </button>

        <section className="mt-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="mb-1 text-sm font-semibold text-gray-900">{t("privacy.title")}</h2>
          <p className="mb-4 text-xs text-gray-500">{t("privacy.subtitle")}</p>

          <div className="flex flex-col gap-3 border-b border-gray-100 pb-5">
            <div>
              <p className="text-sm font-medium text-gray-900">{t("privacy.exportTitle")}</p>
              <p className="text-xs text-gray-500">{t("privacy.exportHint")}</p>
            </div>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex w-fit items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-60"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exporting ? t("privacy.exporting") : t("privacy.exportCta")}
            </button>
          </div>

          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-800">{t("privacy.dangerZone")}</p>
            <p className="mt-1 text-xs text-red-700">{t("privacy.deleteHint")}</p>
            <button
              type="button"
              onClick={() => setShowDeleteDialog(true)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              <Trash2 className="h-4 w-4" />
              {t("privacy.deleteCta")}
            </button>
          </div>
        </section>

        {showDeleteDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-base font-semibold text-gray-900">{t("privacy.confirmTitle")}</h3>
              <p className="mt-2 text-sm text-gray-600">{t("privacy.confirmBody")}</p>
              <p className="mt-3 text-xs text-gray-500">
                {t("privacy.typeToConfirm", { word: deleteConfirmWord })}
              </p>
              <input
                type="text"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={deleteConfirmWord}
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteDialog(false);
                    setDeleteConfirm("");
                  }}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting || deleteConfirm !== deleteConfirmWord}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {t("privacy.deleteConfirm")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="pr-4">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-7 w-12 rounded-full transition ${
          value ? "bg-[#1D6BF3]" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition ${
            value ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function MiniToggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-700">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-10 rounded-full transition disabled:opacity-60 ${
          value ? "bg-[#1D6BF3]" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            value ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
      {label}
    </label>
  );
}
