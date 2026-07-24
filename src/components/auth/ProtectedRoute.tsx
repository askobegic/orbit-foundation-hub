import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useAuth } from "@/context/AuthContext";

interface Props {
  children: ReactNode;
  requireComplete?: boolean;
}

export function ProtectedRoute({ children, requireComplete = true }: Props) {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate({ to: "/login", replace: true });
      return;
    }
    if (requireComplete && profile && !profile.profile_complete) {
      void navigate({ to: "/onboarding", replace: true });
    }
  }, [loading, user, profile, requireComplete, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1D6BF3] border-t-transparent" />
      </div>
    );
  }
  if (requireComplete && (!profile || !profile.profile_complete)) return null;
  return <>{children}</>;
}