// Universal Pre-Launch / Public Launch Standard -- the one generic gate
// every route goes through, applied at the root layout so direct URL
// access is covered exactly like normal navigation (see __root.tsx). Never
// gates the CORE platform itself (slug === 'core' is always let through
// regardless of its launch_status value -- see the migration comment).
//
// Mirrors this codebase's existing route-protection shape exactly
// (AdminGate in admin.tsx / ProtectedRoute.tsx): a client component that
// withholds rendering the protected subtree (so its data-fetching effects
// never fire) until authorization is known, rather than a TanStack Start
// `beforeLoad`/loader -- this app uses that pattern nowhere else. Real
// enforcement comes from RLS on user_roles / application_test_users (the
// same tables AdminGate and adminSetTrustedAdvertiser already rely on),
// not from hiding UI.
import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { useApplication } from "@/context/ApplicationContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { PreLaunchFrontPage } from "@/components/launch/PreLaunchFrontPage";

// Always reachable regardless of launch_status: the auth bootstrap flow
// (a visitor must be able to sign in / register before CORE can ever know
// whether they're the admin or an authorized test user -- see
// PROJECT_KNOWLEDGE.md -> Pre-Launch / Public Launch), and the CORE admin
// panel itself (already independently gated by AdminGate; never part of
// "the connected application" a public visitor is trying to reach).
const ALWAYS_ALLOWED_PREFIXES = ["/login", "/auth/callback", "/onboarding", "/admin"];

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1D6BF3] border-t-transparent" />
    </div>
  );
}

export function LaunchGate({ children }: { children: ReactNode }) {
  const { application, loading: appLoading } = useApplication();
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const isCore = application?.slug === "core";
  const isPreLaunch = !!application && !isCore && application.launch_status === "pre_launch";
  const isAllowedPath = ALWAYS_ALLOWED_PREFIXES.some(
    (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
  );

  const authQ = useQuery({
    queryKey: ["launch-access", application?.id, user?.id],
    enabled: isPreLaunch && !isAllowedPath && !!user?.id && !!application?.id,
    queryFn: async () => {
      const [{ data: roleRow }, { data: testRow }] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("role", "admin")
          .maybeSingle(),
        supabase
          .from("application_test_users")
          .select("user_id")
          .eq("user_id", user!.id)
          .eq("app_id", application!.id)
          .maybeSingle(),
      ]);
      return { authorized: !!roleRow || !!testRow };
    },
  });

  const shouldRedirectToRoot =
    isPreLaunch &&
    !isAllowedPath &&
    location.pathname !== "/" &&
    !authLoading &&
    (!user || (!authQ.isPending && !authQ.data?.authorized));

  useEffect(() => {
    if (shouldRedirectToRoot) void navigate({ to: "/", replace: true });
  }, [shouldRedirectToRoot, navigate]);

  // Don't render the protected subtree (and let its data queries fire)
  // until we know which application this is and, for a pre-launch
  // application, until authorization is resolved.
  if (appLoading) return <Spinner />;
  if (!isPreLaunch || isAllowedPath || !application) return <>{children}</>;

  if (!user) {
    return location.pathname === "/" ? (
      <PreLaunchFrontPage application={application} />
    ) : (
      <Spinner />
    );
  }

  if (authLoading || authQ.isPending) return <Spinner />;
  if (authQ.data?.authorized) return <>{children}</>;

  return location.pathname === "/" ? <PreLaunchFrontPage application={application} /> : <Spinner />;
}
