import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type {
  ApplicationRow,
  PremiumProfileRow,
  ProfileRow,
} from "@/types/database";

export const Route = createFileRoute("/u/$username")({
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} — Core Platform` },
      { name: "description", content: `Public profile of @${params.username}.` },
      { property: "og:title", content: `@${params.username}` },
      { property: "og:description", content: `Public profile on Core Platform.` },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PublicBioCard,
});

function PublicBioCard() {
  const { username } = Route.useParams();
  const { t } = useTranslation();
  const { user } = useAuth();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [premium, setPremium] = useState<PremiumProfileRow | null>(null);
  const [isPremiumActive, setIsPremiumActive] = useState(false);
  const [apps, setApps] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setNotFound(false);
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("username", username)
        .eq("is_active", true)
        .maybeSingle();
      const p = data as ProfileRow | null;
      if (!p) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setProfile(p);
      const [{ data: prem }, { data: subs }, { data: allApps }] = await Promise.all([
        supabase.from("premium_profiles").select("*").eq("user_id", p.id).maybeSingle(),
        supabase.from("subscriptions").select("id").eq("user_id", p.id).eq("status", "active").limit(1),
        supabase.from("applications").select("*").eq("status", "active").order("sort_order"),
      ]);
      setPremium((prem as PremiumProfileRow | null) ?? null);
      setIsPremiumActive(!!subs && subs.length > 0);
      setApps((allApps as ApplicationRow[] | null) ?? []);
      setLoading(false);
    })();
  }, [username]);

  function handleShare() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    void navigator.clipboard.writeText(url);
    toast.success(t("profile.linkCopied"));
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1D6BF3] border-t-transparent" />
      </div>
    );
  }
  if (notFound || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">{t("profile.notFound")}</h1>
          <Link to="/" className="mt-3 inline-block text-sm text-[#1D6BF3] hover:underline">
            ← {t("nav.home")}
          </Link>
        </div>
      </div>
    );
  }

  const fullName = `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
  const memberYear = new Date(profile.created_at).getFullYear();
  const yearsExp = Math.max(1, new Date().getFullYear() - memberYear);

  return (
    <main
      className="min-h-screen px-4 py-6"
      style={{ background: "linear-gradient(135deg, #EEF2FF 0%, #F0F9FF 50%, #F0FDF4 100%)" }}
    >
      <nav className="mx-auto mb-6 flex max-w-[460px] items-center justify-between">
        <Link to="/" className="text-lg font-bold text-gray-900">Core</Link>
        {!user && (
          <div className="flex gap-2">
            <Link to="/login" className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white/60">
              {t("auth.login")}
            </Link>
            <Link to="/login" className="rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#155ac9]">
              {t("auth.register")}
            </Link>
          </div>
        )}
      </nav>

      <div
        className="mx-auto w-full max-w-[460px] overflow-hidden rounded-2xl bg-white"
        style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}
      >
        <div
          className="relative h-28"
          style={{
            background: "linear-gradient(135deg, #1D6BF3 0%, #8B5CF6 100%)",
            backgroundImage:
              "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.18) 1px, transparent 1px), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.12) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          <button
            type="button"
            onClick={handleShare}
            className="absolute right-3 top-3 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-gray-700 shadow hover:bg-white"
          >
            {t("profile.shareProfile")}
          </button>
        </div>

        <div className="relative px-6 pb-6">
          <div className="-mt-11 flex justify-start">
            <div className="h-[88px] w-[88px] overflow-hidden rounded-full border-4 border-white bg-gray-100 shadow">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={fullName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-gray-400">?</div>
              )}
            </div>
          </div>

          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900">{fullName || `@${username}`}</h1>
              {profile.is_verified && <span title={t("profile.verified")} className="text-[#1D6BF3]">✓</span>}
              {isPremiumActive && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                  {t("profile.premium")}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">@{profile.username ?? username}</p>
            {profile.bio && <p className="mt-2 text-sm text-gray-700">{profile.bio}</p>}
            <p className="mt-2 text-xs text-gray-500">
              {profile.city ?? ""}{profile.city && profile.country ? ", " : ""}{profile.country ?? ""}
            </p>
            <p className="text-xs text-gray-400">{t("profile.memberSince")} {memberYear}</p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-gray-50 p-3 text-center">
            <Stat label={t("profile.reviews")} value="0" />
            <Stat label={t("profile.rating")} value="★ —" />
            <Stat label={t("profile.experience")} value={String(yearsExp)} />
          </div>

          <div className="mt-4">
            {!isPremiumActive || !user ? (
              <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-blue-50 p-4 text-center">
                <p className="text-sm font-medium text-purple-900">{t("profile.registerToSee")}</p>
                {!user && (
                  <Link to="/login" className="mt-2 inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700">
                    {t("profile.registerFree")}
                  </Link>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {premium?.phone && premium.phone_public && (
                  <a href={`tel:${premium.phone}`} className="rounded-lg bg-[#1D6BF3] px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#155ac9]">
                    📞 {premium.phone}
                  </a>
                )}
                {premium?.whatsapp && premium.whatsapp_public && (
                  <a href={`https://wa.me/${premium.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="rounded-lg bg-green-500 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-green-600">
                    WhatsApp
                  </a>
                )}
                {premium?.contact_email && premium.contact_email_public && (
                  <a href={`mailto:${premium.contact_email}`} className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50">
                    ✉ {premium.contact_email}
                  </a>
                )}
                {premium?.website && premium.website_public && (
                  <a href={premium.website} target="_blank" rel="noreferrer" className="rounded-lg bg-green-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-green-700">
                    🌐 {t("profile.website")}
                  </a>
                )}
              </div>
            )}
          </div>

          {isPremiumActive && premium && <SocialRow premium={premium} />}

          {apps.length > 0 && (
            <div className="mt-5">
              <h2 className="mb-2 text-xs font-semibold uppercase text-gray-500">{t("nav.applications")}</h2>
              <div className="grid grid-cols-2 gap-2">
                {apps.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2">
                    <div className="h-8 w-8 rounded-lg" style={{ background: a.primary_color }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{a.name}</p>
                      <p className="text-[10px] text-gray-400">{isPremiumActive ? t("profile.premium") : "Free"}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!user && (
            <div className="mt-5 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 p-4 text-center text-white">
              <p className="text-sm font-semibold">{t("profile.createYourProfile")}</p>
              <Link to="/login" className="mt-2 inline-block rounded-lg bg-white px-4 py-2 text-sm font-semibold text-purple-700 hover:bg-gray-100">
                {t("auth.register")}
              </Link>
            </div>
          )}
        </div>
      </div>

      <footer className="mx-auto mt-6 max-w-[460px] text-center text-xs text-gray-500">
        {t("profile.createYourProfile")} · Core Platform
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-base font-semibold text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-500">{label}</p>
    </div>
  );
}

function SocialRow({ premium }: { premium: PremiumProfileRow }) {
  const links: [string, string | null][] = [
    ["Facebook", premium.facebook_url],
    ["Instagram", premium.instagram_url],
    ["TikTok", premium.tiktok_url],
    ["YouTube", premium.youtube_url],
    ["LinkedIn", premium.linkedin_url],
    ["X", premium.x_url],
  ];
  const active = links.filter(([, url]) => !!url);
  if (active.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {active.map(([name, url]) => (
        <a key={name} href={url!} target="_blank" rel="noreferrer" className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          {name}
        </a>
      ))}
    </div>
  );
}