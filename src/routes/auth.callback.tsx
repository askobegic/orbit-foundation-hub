import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const [status, setStatus] = useState("Prijava u toku...");

  useEffect(() => {
    const handle = async () => {
      // Check for error in URL
      const params = new URLSearchParams(window.location.search);
      const error = params.get("error");
      const errorDesc = params.get("error_description");

      if (error) {
        console.error("[auth/callback] Error:", error, errorDesc);
        setStatus("Greška pri prijavi...");
        setTimeout(() => {
          window.location.href = "/login";
        }, 2000);
        return;
      }

      // Check for code (PKCE flow)
      const code = params.get("code");
      if (code) {
        setStatus("Potvrđivanje...");
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          console.error("[auth/callback] Exchange error:", exchangeError);
          setStatus("Greška pri potvrdi...");
          setTimeout(() => {
            window.location.href = "/login";
          }, 2000);
          return;
        }
      }

      // Check for hash (implicit flow)
      const hash = window.location.hash;
      if (hash && hash.includes("access_token")) {
        setStatus("Učitavanje sesije...");
        await new Promise(r => setTimeout(r, 500));
      }

      // Get session
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        // Check profile
        const { data: profile } = await supabase
          .from("profiles")
          .select("profile_complete")
          .eq("id", data.session.user.id)
          .maybeSingle();

        if (profile?.profile_complete) {
          window.location.href = "/dashboard";
        } else {
          window.location.href = "/onboarding";
        }
      } else {
        // Wait for auth state change
        setStatus("Čekanje...");
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event, session) => {
            if (event === "SIGNED_IN" && session) {
              subscription.unsubscribe();
              const { data: profile } = await supabase
                .from("profiles")
                .select("profile_complete")
                .eq("id", session.user.id)
                .maybeSingle();
              window.location.href = profile?.profile_complete ? "/dashboard" : "/onboarding";
            }
          }
        );

        // Timeout fallback
        setTimeout(() => {
          subscription.unsubscribe();
          window.location.href = "/login";
        }, 5000);
      }
    };

    void handle();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center"
      style={{ background: "linear-gradient(135deg, #EEF2FF 0%, #F0F9FF 50%, #F0FDF4 100%)" }}
    >
      <div className="text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mx-auto mb-4" />
        <p className="text-gray-600 text-sm font-medium">{status}</p>
      </div>
    </div>
  );
}
