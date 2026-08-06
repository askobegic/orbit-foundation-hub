import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/context/AuthContext";
import { useApplication } from "@/context/ApplicationContext";
import { supabase } from "@/integrations/supabase/client";
import { ProfileCard } from "@/components/profile/ProfileCard";
import type { PremiumProfileRow, ProfileRow } from "@/types/database";

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
  const { application, loading: applicationLoading } = useApplication();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [premium, setPremium] = useState<PremiumProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // null = not checked yet. `user_app_settings.is_visible` means "does this
  // user have a public profile on this application at all" -- it is a
  // presence gate, never a Premium-to-Standard downgrade (that logic lives
  // entirely in ProfileCard, which does not consume is_visible).
  const [visibleHere, setVisibleHere] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setNotFound(false);
      setVisibleHere(null);
      const { data } = await supabase
        .from("profiles_public")
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

      const { data: prem } = await supabase
        .from("premium_profiles_public")
        .select("*")
        .eq("user_id", p.id)
        .maybeSingle();
      setPremium((prem as PremiumProfileRow | null) ?? null);
      setLoading(false);
    })();
  }, [username]);

  useEffect(() => {
    if (!profile || applicationLoading) return;
    if (!application) {
      setVisibleHere(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_app_settings")
        .select("is_visible")
        .eq("user_id", profile.id)
        .eq("app_id", application.id)
        .maybeSingle();
      if (!cancelled) {
        setVisibleHere((data as { is_visible: boolean } | null)?.is_visible ?? true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, application, applicationLoading]);

  if (loading || (profile && !notFound && (applicationLoading || visibleHere === null))) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1D6BF3] border-t-transparent" />
      </div>
    );
  }
  if (notFound || !profile || visibleHere === false) {
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

  return (
    <main
      className="min-h-screen px-4 py-6"
      style={{ background: "linear-gradient(135deg, #EEF2FF 0%, #F0F9FF 50%, #F0FDF4 100%)" }}
    >
      <nav className="mx-auto mb-6 flex max-w-[420px] flex-wrap items-center justify-between gap-2">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          {application?.logo_url ? (
            <img
              src={application.logo_url}
              alt={application.name}
              className="h-7 w-7 shrink-0 rounded-lg object-contain"
            />
          ) : (
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
              style={{ backgroundColor: application?.primary_color ?? "#1D6BF3" }}
            >
              {application?.name.slice(0, 1) ?? ""}
            </div>
          )}
          <span className="truncate text-lg font-bold text-gray-900">{application?.name ?? ""}</span>
        </Link>
        {!user && (
          <div className="flex shrink-0 gap-2">
            <Link
              to="/login"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-white/60"
            >
              {t("auth.login")}
            </Link>
            <Link
              to="/login"
              className="rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#155ac9]"
            >
              {t("auth.register")}
            </Link>
          </div>
        )}
      </nav>

      <div className="mx-auto flex w-full max-w-[420px] flex-col items-center">
        <ProfileCard profile={profile} premiumProfile={premium} viewerId={user?.id ?? null} />

        {!user && (
          <div className="mt-5 w-full rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 p-4 text-center text-white">
            <p className="text-sm font-semibold">{t("profile.createYourProfile")}</p>
            <Link
              to="/login"
              className="mt-2 inline-block rounded-lg bg-white px-4 py-2 text-sm font-semibold text-purple-700 hover:bg-gray-100"
            >
              {t("auth.register")}
            </Link>
          </div>
        )}
      </div>

      <footer className="mx-auto mt-6 max-w-[420px] text-center text-xs text-gray-500">
        {t("profile.createYourProfile")} · {application?.name ?? ""}
      </footer>
    </main>
  );
}
