// API_CONTRACT.md §7 -- GET /v1/me/launch-access. Universal Pre-Launch /
// Public Launch Standard: the one generic read a CORE-connected
// application's own separate deployment calls to decide whether the
// current caller may access its (application-owned, not CORE-owned)
// pages -- see PROJECT_KNOWLEDGE.md -> Applications Registry &
// Capabilities -> Pre-Launch / Public Launch and CORE-APP-STANDARD.md.
// Scoped by the caller's own JWT `azp` (API_CONTRACT.md §3.3) -- "current
// application" is never a caller-supplied parameter here, same rule every
// other azp-scoped endpoint in this contract already follows. The CORE
// platform's own application row (slug === 'core') always reports
// authorized: true regardless of its launch_status value -- CORE itself is
// never gated by this mechanism.
import { createFileRoute } from "@tanstack/react-router";

import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/launch-access")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: app, error } = await supabaseAdmin
          .from("applications")
          .select("id, slug, launch_status")
          .eq("id", ctx.appId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!app) throw new ApiError("NOT_FOUND", "Application not found");

        if (app.slug === "core" || app.launch_status === "public") {
          return apiData({ launchStatus: app.launch_status, authorized: true });
        }

        const { assertAdmin } = await import("@/lib/admin.server");
        let isAdmin = true;
        try {
          await assertAdmin(supabaseAdmin, ctx.userId);
        } catch {
          isAdmin = false;
        }

        let authorized = isAdmin;
        if (!authorized) {
          const { data: testRow } = await supabaseAdmin
            .from("application_test_users")
            .select("user_id")
            .eq("user_id", ctx.userId)
            .eq("app_id", app.id)
            .maybeSingle();
          authorized = !!testRow;
        }

        return apiData({ launchStatus: app.launch_status, authorized });
      }),
    },
  },
});
