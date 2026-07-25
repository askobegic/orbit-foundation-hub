import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Prijava — Core Platform" },
      { name: "description", content: "Prijavite se na Core Platform putem Google naloga." },
      { property: "og:title", content: "Prijava — Core Platform" },
      { property: "og:description", content: "Prijavite se na Core Platform putem Google naloga." },
    ],
  }),
  component: LoginPage,
});

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.75 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.05-3.72 1.05-2.86 0-5.28-1.93-6.15-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.85 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.67-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.67 2.84C6.72 7.3 9.14 5.38 12 5.38z" />
    </svg>
  );
}

function LoginPage() {
  const { t } = useTranslation();
  const { user, profile, loading, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    if (!profile || !profile.profile_complete) {
      void navigate({ to: "/onboarding", replace: true });
    } else {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, user, profile, navigate]);

  async function handleGoogle() {
    setBusy(true);
    const { error } = await signInWithGoogle();
    if (error) {
      toast.error(t("auth.loginError"));
      setBusy(false);
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #EEF2FF 0%, #F0F9FF 50%, #F0FDF4 100%)" }}
    >
      <div
        className="w-full max-w-[400px] rounded-2xl bg-white p-10"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
      >
        <div className="mb-6 flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1D6BF3] text-lg font-bold text-white">
            C
          </div>
        </div>
        <h1 className="mb-8 text-center text-2xl font-semibold text-gray-900">
          {t("auth.welcome")}
        </h1>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded-[10px] border border-[#E5E7EB] bg-white px-4 py-3 text-[15px] font-semibold text-[#374151] transition hover:bg-gray-50 disabled:opacity-60"
        >
          {busy ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          ) : (
            <GoogleIcon />
          )}
          {t("auth.loginWithGoogle")}
        </button>

        <LanguageSwitcher className="mt-6" />

        <p className="mt-6 text-center text-xs text-gray-500">© 2025 Core Platform</p>
      </div>
    </main>
  );
}
