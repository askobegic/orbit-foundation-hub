import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  useEffect(() => {
    const exchangeCode = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          window.location.href = "/dashboard";
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        window.location.href = "/dashboard";
      } else {
        window.location.href = "/login";
      }
    };

    void exchangeCode();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mx-auto mb-4" />
        <p className="text-gray-500 text-sm">Prijava u toku...</p>
      </div>
    </div>
  );
}
