import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { CountrySelect } from "@/components/ui/CountrySelect";
import { supabase } from "@/integrations/supabase/client";
import type { UserLanguage } from "@/types/database";
import { useServerFn } from "@tanstack/react-start";
import { notifyNewUserRegistered } from "@/lib/notifications.functions";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Kompletiraj profil — Core Platform" },
      { name: "description", content: "Postavite fotografiju i osnovne informacije da završite registraciju." },
      { property: "og:title", content: "Kompletiraj profil — Core Platform" },
      { property: "og:description", content: "Postavite fotografiju i osnovne informacije da završite registraciju." },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { t } = useTranslation();
  const { user, profile, loading, updateProfile, refreshProfile } = useAuth();
  const { language, setLanguage: setAppLanguage } = useLanguage();
  const navigate = useNavigate();
  const notifyNewUser = useServerFn(notifyNewUserRegistered);

  const [step, setStep] = useState<1 | 2>(1);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFromProvider, setAvatarFromProvider] = useState<null | "google" | "apple">(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("BA");
  const [bio, setBio] = useState("");
  const [lang, setLang] = useState<UserLanguage>(language);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate({ to: "/login", replace: true });
      return;
    }
    if (profile?.profile_complete) {
      void navigate({ to: "/dashboard", replace: true });
      return;
    }
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
    const fullName = str(meta.full_name) || str(meta.name);
    const [splitFirst, ...splitRest] = fullName.split(" ");
    const metaFirst = str(meta.given_name) || str(meta.first_name) || splitFirst || "";
    const metaLast = str(meta.family_name) || str(meta.last_name) || splitRest.join(" ") || "";
    const metaAvatar = str(meta.avatar_url) || str(meta.picture);
    const provider = ((user.app_metadata as Record<string, unknown> | undefined)?.provider ?? "").toString();

    setAvatarUrl(profile?.avatar_url ?? metaAvatar ?? null);
    setFirstName(profile?.first_name ?? metaFirst);
    setLastName(profile?.last_name ?? metaLast);
    setCity(profile?.city ?? "");
    setCountry(profile?.country ?? "BA");
    setBio(profile?.bio ?? "");
    setLang(profile?.language ?? language);
    if (metaAvatar && (!profile?.avatar_url || profile.avatar_url === metaAvatar)) {
      setAvatarFromProvider(provider === "apple" ? "apple" : provider === "google" ? "google" : null);
    }
  }, [loading, user, profile, navigate, language]);

  async function handleUpload(file: File) {
    if (!user) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("auth.uploadError"));
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error(t("auth.uploadError"));
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/avatar.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (error) throw error;
      const { data: signed, error: signErr } = await supabase.storage
        .from("avatars")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr) throw signErr;
      setAvatarUrl(signed.signedUrl);
    } catch {
      toast.error(t("auth.uploadError"));
    } finally {
      setUploading(false);
    }
  }

  async function handleComplete() {
    if (!avatarUrl) {
      toast.error(t("auth.photoRequired"));
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !city.trim() || !country.trim()) return;
    setSaving(true);
    try {
      await updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        city: city.trim(),
        country: country.trim(),
        bio: bio.trim() || null,
        avatar_url: avatarUrl,
        language: lang,
        profile_complete: true,
      });
      await setAppLanguage(lang);
      await refreshProfile();
      try {
        await notifyNewUser({});
      } catch (err) {
        console.warn("[n8n] notify new user failed", err);
      }
      toast.success(t("auth.profileSaved"));
      void navigate({ to: "/dashboard", replace: true });
    } catch {
      toast.error(t("auth.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #EEF2FF 0%, #F0F9FF 50%, #F0FDF4 100%)" }}
    >
      <div
        className="w-full max-w-[440px] rounded-2xl bg-white p-8"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
      >
        <div className="mb-6 flex items-center gap-2 text-xs font-medium text-gray-500">
          <span className={step === 1 ? "text-[#1D6BF3]" : ""}>1. {t("auth.step1")}</span>
          <span>—</span>
          <span className={step === 2 ? "text-[#1D6BF3]" : ""}>2. {t("auth.step2")}</span>
        </div>
        <h1 className="mb-6 text-xl font-semibold text-gray-900">{t("auth.completeProfile")}</h1>

        {step === 1 ? (
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-gray-100">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <span className="text-gray-400">?</span>
              )}
            </div>
            {avatarFromProvider && (
              <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <span>✓</span>
                {avatarFromProvider === "apple"
                  ? t("auth.photoImportedApple")
                  : t("auth.photoImportedGoogle")}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setAvatarFromProvider(null);
                  void handleUpload(f);
                }
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {uploading ? t("common.loading") : avatarUrl ? t("auth.changePhoto") : t("auth.uploadPhoto")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!avatarUrl) {
                  toast.error(t("auth.photoRequired"));
                  return;
                }
                setStep(2);
              }}
              className="mt-2 w-full rounded-[10px] bg-[#1D6BF3] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#155ac9] disabled:opacity-60"
            >
              {t("auth.continue")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label={t("profile.firstName")} value={firstName} onChange={setFirstName} required />
            <Field label={t("profile.lastName")} value={lastName} onChange={setLastName} required />
            <label className="text-sm font-medium text-gray-700">
              {t("profile.city")} *
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={t("profile.cityPlaceholder")}
                className="mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#1D6BF3]"
              />
            </label>
            <label className="text-sm font-medium text-gray-700">
              {t("profile.country")} *
              <CountrySelect value={country} onChange={setCountry} />
            </label>
            <label className="text-sm font-medium text-gray-700">
              {t("profile.bio")}
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 300))}
                rows={3}
                className="mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#1D6BF3]"
              />
              <span className="text-xs text-gray-400">{bio.length}/300</span>
            </label>
            <div>
              <span className="text-sm font-medium text-gray-700">{t("common.language")}</span>
              <div className="mt-2 flex gap-3">
                {(["bs", "en", "de"] as UserLanguage[]).map((l) => (
                  <label key={l} className="flex items-center gap-1 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="lang"
                      value={l}
                      checked={lang === l}
                      onChange={() => setLang(l)}
                    />
                    {l.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={handleComplete}
              disabled={saving}
              className="mt-2 w-full rounded-[10px] bg-[#1D6BF3] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#155ac9] disabled:opacity-60"
            >
              {saving ? t("common.loading") : t("auth.completeRegistration")}
            </button>
          </div>
        )}

        <LanguageSwitcher className="mt-6" />
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-medium text-gray-700">
      {label}
      {required ? " *" : ""}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm outline-none focus:border-[#1D6BF3]"
      />
    </label>
  );
}