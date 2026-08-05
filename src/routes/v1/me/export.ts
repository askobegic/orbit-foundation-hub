// API_CONTRACT.md §6 -- POST /v1/me/export (GDPR). Same aggregate
// exportUserData already produces (gdpr.functions.ts), reshaped to
// camelCase -- not reused by direct call since that function has
// requireSupabaseAuth middleware; identical parallel-select shape here.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/export")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const [profile, premium, subs, payments, notifications, appSettings] = await Promise.all([
          supabaseAdmin.from("profiles").select("*").eq("id", ctx.userId).maybeSingle(),
          supabaseAdmin
            .from("premium_profiles")
            .select("*")
            .eq("user_id", ctx.userId)
            .maybeSingle(),
          supabaseAdmin.from("subscriptions").select("*").eq("user_id", ctx.userId),
          supabaseAdmin.from("payments").select("*").eq("user_id", ctx.userId),
          supabaseAdmin.from("notifications").select("*").eq("user_id", ctx.userId),
          supabaseAdmin.from("user_app_settings").select("*").eq("user_id", ctx.userId),
        ]);

        return apiData({
          exportedAt: new Date().toISOString(),
          profile: profile.data ?? null,
          premiumProfile: premium.data ?? null,
          subscriptions: subs.data ?? [],
          payments: payments.data ?? [],
          notifications: notifications.data ?? [],
          appSettings: appSettings.data ?? [],
        });
      }),
    },
  },
});
