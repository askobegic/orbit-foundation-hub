// API_CONTRACT.md §10 -- GET /v1/me/entitlements. The cross-application
// read layer for Commercial Products (Listing/Sponsored/other
// application-specific benefits) -- deliberately NOT a second Premium
// endpoint. Global Premium is already served by the existing
// /v1/me/premium (a direct pass-through of resolvePremiumStatus()); this
// endpoint excludes any benefit_type marked grants_premium=true in
// reward_fulfillment_types so the two endpoints never report overlapping
// information. Scoped by the caller's own JWT `azp` (API_CONTRACT.md §3.3)
// -- an application only ever sees entitlements that are either global or
// belong to itself, never another application's, closing the same
// cross-application information-disclosure surface every other
// azp-scoped endpoint in this contract already closes.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

type EntitlementRow = {
  benefit_type: string;
  app_id: string | null;
  starts_at: string;
  ends_at: string | null;
  reward_fulfillment_types: { label: string } | null;
};

export const Route = createFileRoute("/v1/me/entitlements")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const now = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from("entitlements")
          .select("benefit_type, app_id, starts_at, ends_at, reward_fulfillment_types!inner(label)")
          .eq("user_id", ctx.userId)
          .eq("status", "active")
          .eq("reward_fulfillment_types.grants_premium", false)
          .or(`app_id.is.null,app_id.eq.${ctx.appId}`)
          // Matches findActiveEntitlement()'s exact validity semantics
          // (entitlements.server.ts) -- started, not yet ended -- so this
          // list endpoint never disagrees with the single-entitlement
          // resolver every grant/extend/dependency check uses.
          .lte("starts_at", now)
          .or(`ends_at.is.null,ends_at.gt.${now}`)
          .order("starts_at", { ascending: false });
        if (error) throw new Error(error.message);

        const entitlements = ((data ?? []) as unknown as EntitlementRow[]).map((e) => ({
          benefitType: e.benefit_type,
          label: e.reward_fulfillment_types?.label ?? e.benefit_type,
          appId: e.app_id,
          startsAt: e.starts_at,
          expiresAt: e.ends_at,
        }));

        return apiData({ entitlements });
      }),
    },
  },
});
