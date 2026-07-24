import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { updateUserSettings } from "@/lib/notifications.functions";

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
  const { profile, refreshProfile } = useAuth();
  const { setLanguage } = useLanguage();
  const save = useServerFn(updateUserSettings);

  const [lang, setLang] = useState<"bs" | "en" | "de">("bs");
  const [email, setEmail] = useState(true);
  const [inApp, setInApp] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setLang(((profile.language ?? "bs") as "bs" | "en" | "de"));
    const p = profile as unknown as {
      notify_email?: boolean;
      notify_in_app?: boolean;
      notify_marketing?: boolean;
    };
    setEmail(p.notify_email ?? true);
    setInApp(p.notify_in_app ?? true);
    setMarketing(p.notify_marketing ?? false);
  }, [profile]);

  async function handleSave() {
    setSaving(true);
    try {
      await save({
        data: {
          language: lang,
          notify_email: email,
          notify_in_app: inApp,
          notify_marketing: marketing,
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

  return (
    <div className="min-h-screen bg-[#F7F8FA] px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">{t("settings.title")}</h1>
          <p className="text-sm text-gray-500">{t("settings.subtitle")}</p>
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

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1D6BF3] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1758C6] disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? t("common.saving") : t("common.save")}
        </button>
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
        className={`relative h-6 w-11 rounded-full transition ${
          value ? "bg-[#1D6BF3]" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
            value ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}