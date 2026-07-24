import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Core Platform — Prijava" },
      { name: "description", content: "Jedinstvena platforma za sve naše aplikacije." },
      { property: "og:title", content: "Core Platform" },
      { property: "og:description", content: "Jedinstvena platforma za sve naše aplikacije." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const { user, profile, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    if (!user) void navigate({ to: "/login", replace: true });
    else if (profile && !profile.profile_complete) void navigate({ to: "/onboarding", replace: true });
    else if (profile?.profile_complete) void navigate({ to: "/dashboard", replace: true });
  }, [loading, user, profile, navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1D6BF3] border-t-transparent" />
    </div>
  );
}
