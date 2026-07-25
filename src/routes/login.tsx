import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

const GOOGLE_CLIENT_ID = "655229906985-1av2f5327h4evc381gpb5vs3rv4h1u00.apps.googleusercontent.com";

declare global {
  interface Window {
    handleGoogleCredential?: (response: { credential: string }) => void;
    google?: {
      accounts: {
        id: {
          initialize: (config: object) => void;
          renderButton: (element: HTMLElement, config: object) => void;
          prompt: () => void;
        };
      };
    };
  }
}

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Prijava — Core Platform" },
      { name: "description", content: "Prijavite se na Core Platform." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  // Redirect if already logged in
  useEffect(() => {
    if (loading || !user) return;
    if (!profile || !profile.profile_complete) {
      void navigate({ to: "/onboarding", replace: true });
    } else {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, user, profile, navigate]);

  // Handle Google credential response
  useEffect(() => {
    window.handleGoogleCredential = async (response: { credential: string }) => {
      setBusy(true);
      try {
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: response.credential,
        });
        if (error) {
          console.error("[login] Google error:", error);
          toast.error(t("auth.loginError"));
          setBusy(false);
          return;
        }
        if (data.session) {
          const { data: profileData } = await supabase
            .from("profiles")
            .select("profile_complete")
            .eq("id", data.session.user.id)
            .maybeSingle();
          window.location.href = profileData?.profile_complete ? "/dashboard" : "/onboarding";
        }
      } catch (err) {
        console.error("[login] Error:", err);
        toast.error(t("auth.loginError"));
        setBusy(false);
      }
    };

    return () => {
      delete window.handleGoogleCredential;
    };
  }, [t]);

  // Load Google GSI and render button
  useEffect(() => {
    const initGoogle = () => {
      if (!window.google || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: window.handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
        ux_mode: "popup",
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        width: 340,
        text: "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
      });
    };

    if (window.google) {
      initGoogle();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = initGoogle;
    script.onerror = () => console.error("[login] Failed to load Google GSI");
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);

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

        {/* Google renders its own button here */}
        <div className="flex justify-center">
          {busy ? (
            <div className="flex items-center gap-3 py-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <span className="text-sm text-gray-500">Prijava u toku...</span>
            </div>
          ) : (
            <div ref={googleButtonRef} />
          )}
        </div>

        <LanguageSwitcher className="mt-6" />
        <p className="mt-6 text-center text-xs text-gray-500">© 2025 Core Platform</p>
      </div>
    </main>
  );
}
