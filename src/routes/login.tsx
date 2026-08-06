import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useApplication } from "@/context/ApplicationContext";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

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
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation();
  const { user, profile, loading } = useAuth();
  const { application, loading: applicationLoading } = useApplication();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  const googleClientId = application?.google_client_id ?? null;

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
        // `client_id` is a deprecated fallback alias for `app` -- see
        // application-resolver.functions.ts's file-level comment.
        const params = new URLSearchParams(window.location.search);
        const explicitApp = params.get("app") ?? params.get("client_id");

        // Explicit cross-application login (?app=<slug> -- see
        // ApplicationContext/application-resolver.functions.ts): mint a
        // CORE-issued /v1 session for the originating application via the
        // existing, unchanged POST /v1/auth/session (API_CONTRACT.md §5),
        // and hand the tokens back via URL fragment -- the standard OAuth2
        // Implicit Grant delivery shape -- rather than establishing a
        // same-origin Supabase session here. The redirect target is always
        // the resolved application's own registered domain, never
        // client-supplied, so there is no open-redirect surface.
        if (explicitApp && application?.id && application.domain) {
          const res = await fetch("/v1/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ googleIdToken: response.credential, appId: application.id }),
          });
          const body = await res.json();
          if (!res.ok) {
            console.error("[login] /v1/auth/session failed:", body?.error);
            toast.error(t("auth.loginError"));
            setBusy(false);
            return;
          }
          const { accessToken, refreshToken, expiresIn } = body.data as {
            accessToken: string;
            refreshToken: string;
            expiresIn: number;
          };
          const fragment = new URLSearchParams({
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: String(expiresIn),
            token_type: "bearer",
          });
          window.location.href = `https://${application.domain}/#${fragment.toString()}`;
          return;
        }

        // Same-origin login (Core's own dashboard/admin) -- unchanged.
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
  }, [t, application]);

  // Load Google GSI and render button, once the Application Resolver has
  // supplied this application's own Google Client ID.
  useEffect(() => {
    if (!googleClientId) return;

    const initGoogle = () => {
      if (!window.google || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: window.handleGoogleCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
        ux_mode: "popup",
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        width: Math.min(340, googleButtonRef.current.offsetWidth || 340),
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
  }, [googleClientId]);

  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(135deg, #EEF2FF 0%, #F0F9FF 50%, #F0FDF4 100%)" }}
    >
      <div
        className="w-full max-w-[400px] rounded-2xl bg-white p-6 sm:p-10"
        style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}
      >
        <div className="mb-6 flex justify-center">
          {application?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={application.logo_url}
              alt={application.name}
              className="h-12 w-12 rounded-xl object-contain"
            />
          ) : (
            <div
              className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white"
              style={{ backgroundColor: application?.primary_color ?? "#1D6BF3" }}
            >
              {application?.name.slice(0, 1) ?? ""}
            </div>
          )}
        </div>

        <h1 className="mb-8 text-center text-2xl font-semibold text-gray-900">
          {t("auth.welcome")}
        </h1>

        <div className="flex justify-center">
          {applicationLoading ? (
            <div className="flex items-center gap-3 py-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : busy ? (
            <div className="flex items-center gap-3 py-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <span className="text-sm text-gray-500">{t("auth.signingIn")}</span>
            </div>
          ) : googleClientId ? (
            <div ref={googleButtonRef} />
          ) : (
            <p className="text-center text-sm text-gray-500">{t("auth.notAvailable")}</p>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-gray-500">
          <strong className="font-semibold">{t("auth.identityNoticeLabel")}</strong>{" "}
          {t("auth.identityNoticeBody")}
        </p>

        <LanguageSwitcher className="mt-6" />
        {application?.name && (
          <p className="mt-6 text-center text-xs text-gray-500">© 2025 {application.name}</p>
        )}
      </div>
    </main>
  );
}
