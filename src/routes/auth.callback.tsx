import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_IN" && session) {
          window.location.href = "/dashboard";
        }
      }
    );

    // Also check immediately after small delay
    setTimeout(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        window.location.href = "/dashboard";
      }
    }, 1000);

    return () => subscription.unsubscribe();
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
