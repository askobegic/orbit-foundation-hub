// Priority 15 Phase C: the generic Entitlements layer. For DURATION/ACCESS
// benefits (Premium, VIP, feature access) only -- NOT monetary credit
// ledgers, which already have their own correct pattern (ad_account_credits,
// see fulfillGrant() below). This is a THIRD, independent source alongside
// subscriptions and promotional_trials for has_any_active_premium() --
// neither of those is touched or replaced. See PROJECT_KNOWLEDGE.md ->
// Entitlements for the full architectural decision (C2).
import type { Json } from "@/integrations/supabase/types";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type SupabaseAdmin = Awaited<ReturnType<typeof admin>>;

async function findActiveEntitlement(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
  benefitType: string,
  appId: string | null,
) {
  let query = supabaseAdmin
    .from("entitlements")
    .select("*")
    .eq("user_id", userId)
    .eq("benefit_type", benefitType)
    .eq("status", "active");
  query = appId === null ? query.is("app_id", null) : query.eq("app_id", appId);
  const { data } = await query.maybeSingle();
  return data;
}

export type GrantEntitlementParams = {
  userId: string;
  benefitType: string;
  appId?: string | null;
  // null/undefined = never expires.
  durationDays?: number | null;
  reason?: string | null;
  // null = system-granted (a Mission/Challenge/Streak completion, not an
  // administrator).
  grantedBy?: string | null;
  source: string;
  metadata?: Record<string, unknown>;
};

export type GrantResult = { ok: boolean; entitlementId?: string; error?: string };

// Rejected outright if the user already has an active entitlement of the
// same (benefitType, scope) -- the same "never auto-extends, use Extend
// instead" policy promotional_trials already enforces. The partial unique
// index is the authoritative guard against a race; this pre-check just
// gives a clean error message in the common (non-racing) case.
export async function grantEntitlement(params: GrantEntitlementParams): Promise<GrantResult> {
  const supabaseAdmin = await admin();
  const appId = params.appId ?? null;

  const existing = await findActiveEntitlement(supabaseAdmin, params.userId, params.benefitType, appId);
  if (existing) return { ok: false, error: "already_has_active_entitlement" };

  const endsAt = params.durationDays
    ? new Date(Date.now() + params.durationDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const { data: row, error } = await supabaseAdmin
    .from("entitlements")
    .insert({
      user_id: params.userId,
      benefit_type: params.benefitType,
      app_id: appId,
      ends_at: endsAt,
      granted_by: params.grantedBy ?? null,
      reason: params.reason ?? null,
      source: params.source,
      metadata: (params.metadata ?? {}) as Json,
    })
    .select("*")
    .single();
  if (error) {
    // Partial unique index collision -- a race lost to a concurrent grant.
    if (error.code === "23505") return { ok: false, error: "already_has_active_entitlement" };
    console.error("grantEntitlement: insert failed", error);
    return { ok: false, error: "insert_failed" };
  }

  // Engagement Notifications (Phase D, 15.13): "Benefit granted" -- one
  // central place so every grant path (admin grant, Mission/Challenge/
  // Streak fulfillment, reward redemption) notifies uniformly, via the
  // existing notifications table.
  await supabaseAdmin.from("notifications").insert({
    user_id: params.userId,
    app_id: appId,
    type: "success",
    category: "premium",
    target_path: "/dashboard/rewards",
    title_bs: "Beneficija dodijeljena",
    title_en: "Benefit granted",
    title_de: "Vorteil gewährt",
    message_bs: params.benefitType,
    message_en: params.benefitType,
    message_de: params.benefitType,
  });

  return { ok: true, entitlementId: row.id };
}

export async function extendEntitlement(
  entitlementId: string,
  additionalDays: number,
): Promise<{ ok: boolean; error?: string }> {
  const supabaseAdmin = await admin();
  const { data: existing } = await supabaseAdmin
    .from("entitlements")
    .select("*")
    .eq("id", entitlementId)
    .maybeSingle();
  if (!existing || existing.status !== "active") return { ok: false, error: "not_active" };

  // Extend from the later of "now" or the current expiry -- an already-
  // expired-but-not-yet-marked-ended entitlement extends from today, not
  // from a stale past date.
  const base = existing.ends_at && new Date(existing.ends_at).getTime() > Date.now()
    ? new Date(existing.ends_at)
    : new Date();
  const newEndsAt = new Date(base.getTime() + additionalDays * 24 * 60 * 60 * 1000);

  const { error } = await supabaseAdmin
    .from("entitlements")
    .update({ ends_at: newEndsAt.toISOString(), updated_at: new Date().toISOString() })
    .eq("id", entitlementId);
  if (error) return { ok: false, error: "update_failed" };
  return { ok: true };
}

export async function revokeEntitlement(entitlementId: string): Promise<{ ok: boolean; error?: string }> {
  const supabaseAdmin = await admin();
  const { error } = await supabaseAdmin
    .from("entitlements")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", entitlementId)
    .eq("status", "active");
  if (error) return { ok: false, error: "update_failed" };
  return { ok: true };
}

export type FulfillGrantParams = {
  grantType: string;
  grantValue: Record<string, unknown>;
  userId: string;
  appId?: string | null;
  reason?: string | null;
  grantedBy?: string | null;
  source: string;
};

export type FulfillGrantResult = {
  status: "fulfilled" | "pending_fulfillment";
  entitlementId?: string;
};

// The one fulfillment dispatcher every non-points reward path calls
// (Mission/Challenge/Streak completion in engagement.server.ts, and
// reward_catalog redemption) -- reuses reward_fulfillment_types as the
// vocabulary, never a second registry (C5). 'advertising_credit' routes to
// the EXISTING ad_account_credits ledger (Advertising's own, already-
// correct pattern) -- everything else routes to the generic entitlements
// layer above. A grant_type this dispatcher doesn't recognize (e.g.
// 'featured_slot', deliberately unimplemented since Priority 8.3) stays
// pending_fulfillment, exactly as it already did before this dispatcher
// existed.
export async function fulfillGrant(params: FulfillGrantParams): Promise<FulfillGrantResult> {
  if (params.grantType === "advertising_credit") {
    const amount = Number(params.grantValue.amount ?? 0);
    const currency = typeof params.grantValue.currency === "string" ? params.grantValue.currency : "EUR";
    if (amount > 0) {
      const supabaseAdmin = await admin();
      // ad_account_credits.source is CHECK-constrained to a fixed small
      // set (see 20260801150000_advertising.sql) -- 'reward_redemption' is
      // the closest existing accurate value for "a reward mechanism
      // granted this," reused rather than widening Advertising's own
      // constraint for a Priority 15 concern.
      const { error } = await supabaseAdmin.from("ad_account_credits").insert({
        user_id: params.userId,
        amount,
        currency,
        source: "reward_redemption",
        source_id: null,
      });
      if (!error) return { status: "fulfilled" };
      console.error("fulfillGrant: ad_account_credits insert failed", error);
    }
    return { status: "pending_fulfillment" };
  }

  if (params.grantType === "premium_duration" || params.grantType === "vip" || params.grantType === "feature_access") {
    const durationDays = Number(params.grantValue.durationDays ?? 0) || null;
    const result = await grantEntitlement({
      userId: params.userId,
      benefitType: params.grantType,
      appId: params.appId ?? null,
      durationDays,
      reason: params.reason ?? null,
      grantedBy: params.grantedBy ?? null,
      source: params.source,
    });
    if (result.ok) return { status: "fulfilled", entitlementId: result.entitlementId };
    return { status: "pending_fulfillment" };
  }

  // Unrecognized/deliberately-unimplemented type (e.g. featured_slot).
  return { status: "pending_fulfillment" };
}

export async function getMyEntitlements(userId: string) {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("entitlements")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("ends_at", { ascending: true, nullsFirst: false });
  return data ?? [];
}
