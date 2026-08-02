import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { CountrySelect } from "@/components/ui/CountrySelect";
import { supabase } from "@/integrations/supabase/client";
import { extractIdentityFromAuthUser } from "@/lib/identity";
import { generateUniqueUsername } from "@/lib/username";
import type { UserLanguage } from "@/types/database";
import { useServerFn } from "@tanstack/react-start";
import { notifyNewUserRegistered } from "@/lib/notifications.functions";
import { consumeReferral } from "@/lib/referral";
import { linkReferral } from "@/lib/rewards.functions";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

function OnboardingPage() {
  const { t } = useTranslation();
  const { user, profile, loading, updateProfile, refreshProfile } = useAuth();
  const { language, setLanguage: setAppLanguage } = useLanguage();
  const navigate = useNavigate();
  const notifyNewUser = useServerFn(notifyNewUserRegistered);
  const linkReferralFn = useServerFn(linkReferral);

  const [step, setStep] = useState<1 | 2>(1);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFromProvider, setAvatarFromProvider] = useState(false);
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
    const identity = extractIdentityFromAuthUser(user);

    setAvatarUrl(profile?.avatar_url ?? identity.avatarUrl ?? null);
    setFirstName(profile?.first_name ?? identity.firstName);
    setLastName(profile?.last_name ?? identity.lastName);
    setCity(profile?.city ?? "");
    setCountry(profile?.country ?? "BA");
    setBio(profile?.bio ?? "");
    setLang(profile?.language ?? language);
    if (identity.avatarUrl && (!profile?.avatar_url || profile.avatar_url === identity.avatarUrl)) {
      setAvatarFromProvider(true);
    }
  }, [loading, user, profile, navigate]);

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
      const path = `avatars/${user.id}/avatar.${ext}`;
      const { error } = await supabase.storage.from("core").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (error) throw error;
      const {
        data: { publicUrl },
      } = supabase.storage.from("core").getPublicUrl(path);
      setAvatarUrl(publicUrl);
    } catch {
      toast.error(t("auth.uploadError"));
    } finally {
      setUploading(false);
    }
  }

  async function handleComplete() {
    if (!user) return;
    if (!avatarUrl) {
      toast.error(t("auth.photoRequired"));
      return;
    }
    if (!firstName.trim() || !lastName.trim() || !city.trim() || !country.trim()) return;
    setSaving(true);
    try {
      // Username bootstrap: generate once, only if not already set (e.g. a
      // returning incomplete profile) -- never overwrites an existing one.
      let username = profile?.username ?? "";
      if (!username) {
        username = await generateUniqueUsername(firstName.trim(), lastName.trim(), user.id);
      }
      await updateProfile({
        city: city.trim(),
        country: country.trim(),
        bio: bio.trim() || null,
        avatar_url: avatarUrl,
        username,
        language: lang,
        profile_complete: true,
      });
      await setAppLanguage(lang);
      await refreshProfile();
      try {
        const { data: apps } = await supabase
          .from("applications")
          .select("id")
          .eq("status", "active");
        if (apps && apps.length > 0 && user) {
          const rows = apps.map((a) => ({
            user_id: user.id,
            app_id: a.id,
            is_visible: true,
            is_contactable: true,
          }));
          await supabase
            .from("user_app_settings")
            .upsert(rows, { onConflict: "user_id,app_id", ignoreDuplicates: true });
        }
      } catch (err) {
        console.warn("[onboarding] seed user_app_settings failed", err);
      }
      try {
        await notifyNewUser({});
      } catch (err) {
        console.warn("[n8n] notify new user failed", err);
      }
      const referrerUsername = consumeReferral();
      if (referrerUsername) {
        try {
          await linkReferralFn({ data: { referrerUsername } });
        } catch (err) {
          console.warn("[rewards] link referral failed", err);
        }
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
                {t("auth.photoImported")}
              </div>
            )}
            {/* Identity Lock: a photo, once present (imported or the one
                manual upload below), is never editable again -- no "change
                photo" control is ever shown once avatarUrl is set. */}
            {!avatarUrl && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="rounded-lg border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {uploading ? t("common.loading") : t("auth.uploadPhoto")}
                </button>
              </>
            )}
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
            {/* Identity Lock: name comes from the identity provider and is
                never a free-text field, even before it locks in. */}
            <IdentityField label={t("profile.firstName")} value={firstName} />
            <IdentityField label={t("profile.lastName")} value={lastName} />
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

// Identity Lock: name/photo are imported from the identity provider and are
// never editable, so they render as plain identity information, not a form
// field -- no input element at all.
function IdentityField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-medium text-gray-700">{label}</div>
      <div className="mt-1 text-sm text-gray-900">{value}</div>
    </div>
  );
}
