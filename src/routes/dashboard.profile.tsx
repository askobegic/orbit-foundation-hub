import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AvatarUpload } from "@/components/profile/AvatarUpload";
import { ToggleField } from "@/components/profile/ToggleField";
import { ProfessionTagInput } from "@/components/profile/ProfessionTagInput";
import {
  SocialLinksSection,
  type SocialLinks,
} from "@/components/profile/SocialLinksSection";
import { ProfileCompletionBar } from "@/components/profile/ProfileCompletionBar";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { CountrySelect } from "@/components/ui/CountrySelect";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { generateUniqueUsername } from "@/lib/username";
import { isSafeProfileUrl } from "@/lib/url";
import type {
  PremiumProfileRow,
  UserLanguage,
} from "@/types/database";

export const Route = createFileRoute("/dashboard/profile")({
  head: () => ({
    meta: [
      { title: "Uredi profil — Core Platform" },
      { name: "description", content: "Uredi svoj osnovni i Premium profil." },
      { property: "og:title", content: "Uredi profil — Core Platform" },
      { property: "og:description", content: "Uredi svoj osnovni i Premium profil." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <EditProfilePage />
    </ProtectedRoute>
  ),
});

const EMPTY_SOCIAL: SocialLinks = {
  facebook_url: "",
  instagram_url: "",
  tiktok_url: "",
  youtube_url: "",
  linkedin_url: "",
  x_url: "",
};

function EditProfilePage() {
  const { t } = useTranslation();
  const { user, profile, refreshProfile, updateProfile } = useAuth();
  const { setLanguage: setAppLanguage } = useLanguage();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("BA");
  const [language, setLanguage] = useState<UserLanguage>("bs");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [savingStd, setSavingStd] = useState(false);

  const [premium, setPremium] = useState<PremiumProfileRow | null>(null);
  const [phone, setPhone] = useState("");
  const [phonePublic, setPhonePublic] = useState(false);
  const [whatsapp, setWhatsapp] = useState("");
  const [whatsappPublic, setWhatsappPublic] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [contactEmailPublic, setContactEmailPublic] = useState(false);
  const [website, setWebsite] = useState("");
  const [websitePublic, setWebsitePublic] = useState(false);
  const [primaryProfession, setPrimaryProfession] = useState("");
  const [secondaryProfessions, setSecondaryProfessions] = useState<string[]>([]);
  const [social, setSocial] = useState<SocialLinks>(EMPTY_SOCIAL);
  const [hasPremium, setHasPremium] = useState(false);
  const [savingPrem, setSavingPrem] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.first_name ?? "");
    setLastName(profile.last_name ?? "");
    setCity(profile.city ?? "");
    setCountry(profile.country ?? "BA");
    setLanguage(profile.language);
    setAvatarUrl(profile.avatar_url);
  }, [profile]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      setHasPremium(!!sub);

      const { data } = await supabase
        .from("premium_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      const row = data as PremiumProfileRow | null;
      if (row) {
        setPremium(row);
        setPhone(row.phone ?? "");
        setPhonePublic(!!row.phone_public);
        setWhatsapp(row.whatsapp ?? "");
        setWhatsappPublic(!!row.whatsapp_public);
        setContactEmail(row.contact_email ?? "");
        setContactEmailPublic(!!row.contact_email_public);
        setWebsite(row.website ?? "");
        setWebsitePublic(!!row.website_public);
        setPrimaryProfession(row.primary_profession ?? "");
        setSecondaryProfessions(row.secondary_professions ?? []);
        setSocial({
          facebook_url: row.facebook_url ?? "",
          instagram_url: row.instagram_url ?? "",
          tiktok_url: row.tiktok_url ?? "",
          youtube_url: row.youtube_url ?? "",
          linkedin_url: row.linkedin_url ?? "",
          x_url: row.x_url ?? "",
        });
      }
    })();
  }, [user]);

  async function handleSaveStandard() {
    if (!user) return;
    if (!firstName.trim() || !lastName.trim() || !city.trim() || !country.trim()) {
      toast.error(t("common.error"));
      return;
    }
    setSavingStd(true);
    try {
      let finalUsername = profile?.username ?? "";
      if (!finalUsername) {
        finalUsername = await generateUniqueUsername(firstName, lastName, user.id);
      }
      await updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        city: city.trim(),
        country: country.trim(),
        language,
        avatar_url: avatarUrl,
        username: finalUsername,
        profile_complete: true,
      });
      await setAppLanguage(language);
      await refreshProfile();
      toast.success(t("auth.profileSaved"));
    } catch {
      toast.error(t("auth.saveError"));
    } finally {
      setSavingStd(false);
    }
  }

  async function handleSavePremium() {
    if (!user) return;
    if (!primaryProfession.trim()) {
      toast.error(t("common.error"));
      return;
    }
    const urlFields = [
      website,
      social.facebook_url,
      social.instagram_url,
      social.tiktok_url,
      social.youtube_url,
      social.linkedin_url,
      social.x_url,
    ];
    if (urlFields.some((v) => v.trim() && !isSafeProfileUrl(v.trim()))) {
      toast.error(t("common.error"));
      return;
    }
    setSavingPrem(true);
    try {
      const payload = {
        user_id: user.id,
        phone: phone.trim() || null,
        phone_public: phonePublic,
        whatsapp: whatsapp.trim() || null,
        whatsapp_public: whatsappPublic,
        contact_email: contactEmail.trim() || null,
        contact_email_public: contactEmailPublic,
        website: website.trim() || null,
        website_public: websitePublic,
        primary_profession: primaryProfession.trim(),
        secondary_professions: secondaryProfessions,
        facebook_url: social.facebook_url.trim() || null,
        instagram_url: social.instagram_url.trim() || null,
        tiktok_url: social.tiktok_url.trim() || null,
        youtube_url: social.youtube_url.trim() || null,
        linkedin_url: social.linkedin_url.trim() || null,
        x_url: social.x_url.trim() || null,
      };
      const { error } = premium
        ? await supabase.from("premium_profiles").update(payload).eq("id", premium.id)
        : await supabase.from("premium_profiles").insert(payload);
      if (error) throw error;
      toast.success(t("auth.profileSaved"));
    } catch {
      toast.error(t("auth.saveError"));
    } finally {
      setSavingPrem(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{t("profile.editProfile")}</h1>
            <Link to="/dashboard" className="text-sm text-gray-500 hover:underline">← {t("nav.home")}</Link>
          </div>
          <LanguageSwitcher />
        </header>

        <ProfileCompletionBar profile={profile} />

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("profile.standardProfile")}</h2>
          <div className="flex flex-col gap-4">
            {user && (
              <AvatarUpload userId={user.id} value={avatarUrl} onChange={setAvatarUrl} />
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <TextField label={t("profile.firstName")} value={firstName} onChange={setFirstName} required />
              <TextField label={t("profile.lastName")} value={lastName} onChange={setLastName} required />
              <TextField
                label={t("profile.city")}
                value={city}
                onChange={setCity}
                required
                placeholder={t("profile.cityPlaceholder")}
              />
              <label className="text-sm font-medium text-gray-700">
                {t("profile.country")} *
                <CountrySelect value={country} onChange={setCountry} />
              </label>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-700">{t("common.language")}</span>
              <div className="mt-2 flex gap-3">
                {(["bs", "en", "de"] as UserLanguage[]).map((l) => (
                  <label key={l} className="flex items-center gap-1 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="lang"
                      value={l}
                      checked={language === l}
                      onChange={() => setLanguage(l)}
                    />
                    {l.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={handleSaveStandard}
              disabled={savingStd}
              className="self-start rounded-lg bg-[#1D6BF3] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#155ac9] disabled:opacity-60"
            >
              {savingStd ? t("common.loading") : t("profile.save")}
            </button>
            <Link
              to="/dashboard"
              className="text-sm text-[#1D6BF3] hover:underline"
            >
              ← {t("auth.backToDashboard")}
            </Link>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t("profile.premiumProfile")}</h2>
          {!hasPremium && (
            <div className="mb-4 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50 p-4">
              <p className="text-sm font-medium text-purple-900">{t("profile.premiumLocked")}</p>
              <button className="mt-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700">
                {t("profile.upgradeNow")}
              </button>
            </div>
          )}
          <fieldset disabled={!hasPremium} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <ToggleField label={t("profile.phone")} value={phone} onChange={setPhone} isPublic={phonePublic} onToggle={setPhonePublic} type="tel" disabled={!hasPremium} />
              <ToggleField label={t("profile.whatsapp")} value={whatsapp} onChange={setWhatsapp} isPublic={whatsappPublic} onToggle={setWhatsappPublic} type="tel" disabled={!hasPremium} />
              <ToggleField label={t("profile.contactEmail")} value={contactEmail} onChange={setContactEmail} isPublic={contactEmailPublic} onToggle={setContactEmailPublic} type="email" disabled={!hasPremium} />
              <ToggleField label={t("profile.website")} value={website} onChange={setWebsite} isPublic={websitePublic} onToggle={setWebsitePublic} type="url" disabled={!hasPremium} />
            </div>
            <TextField label={t("profile.primaryProfession")} value={primaryProfession} onChange={setPrimaryProfession} required />
            <div>
              <label className="text-sm font-medium text-gray-700">{t("profile.secondaryProfessions")}</label>
              <div className="mt-1">
                <ProfessionTagInput value={secondaryProfessions} onChange={setSecondaryProfessions} disabled={!hasPremium} />
              </div>
            </div>
            <SocialLinksSection value={social} onChange={setSocial} disabled={!hasPremium} />
            <button
              type="button"
              onClick={handleSavePremium}
              disabled={savingPrem || !hasPremium}
              className="self-start rounded-lg bg-[#1D6BF3] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#155ac9] disabled:opacity-60"
            >
              {savingPrem ? t("common.loading") : t("profile.save")}
            </button>
          </fieldset>
        </section>
      </div>
    </main>
  );
}

function TextField({
  label,
  value,
  onChange,
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="text-sm font-medium text-gray-700">
      {label}
      {required ? " *" : ""}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1D6BF3]"
      />
    </label>
  );
}