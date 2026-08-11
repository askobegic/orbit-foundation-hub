// Priority 8.3: Rewards & Loyalty -- core business logic.
//
// Plain server-only helpers (matching the admin.server.ts split:
// *.server.ts for internal logic, *.functions.ts for the createServerFn
// surface) since these are called both from rewards.functions.ts and
// directly from the Stripe/PayPal webhooks and onboarding.tsx's
// completion flow -- none of those are end-user-invocable RPCs in their
// own right.
//
// The entire "no hardcoded business rules" requirement lives here: every
// point value, cooldown, and limit is looked up from reward_action_rules
// -- there is no switch statement or per-action branch anywhere in this
// file. An action CORE has never heard of (a typo, or a not-yet-
// configured application action) still gets a reward_ledger row for full
// auditability, it just carries 0 points.
import { hasAnyActivePremium } from "@/lib/premium";
import type { Json } from "@/integrations/supabase/types";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function grantRewardAction(params: {
  userId: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  sourceAppId?: string | null;
  // Priority 12 (Universal Event & Rewards Engine) additions -- all
  // optional, all defaulting to the exact behavior every existing call
  // site (webhooks, onboarding, promotePendingReferralVerifications)
  // already gets today. Only the new recordEvent() pipeline (Phase 3)
  // passes these explicitly.
  actorUserId?: string | null; // defaults to userId (actor === recipient, today's implicit behavior)
  lifetimePoints?: number; // defaults to the resolved `points` value
  origin?: "core" | "application" | "api" | "n8n" | "manual_admin" | "system"; // defaults to "core"
  metadata?: Record<string, unknown>; // defaults to {}
  dedupeKey?: string | null;
}): Promise<{ granted: boolean; points: number; reason?: string }> {
  const supabaseAdmin = await admin();

  const { data: rule } = await supabaseAdmin
    .from("reward_action_rules")
    .select("*")
    .eq("action", params.action)
    .maybeSingle();

  let points = 0;
  let reason: string | undefined;

  if (!rule || !rule.enabled || rule.archived) {
    reason = "action_not_configured";
  } else {
    const { count: lifetimeCount } = await supabaseAdmin
      .from("reward_ledger")
      .select("id", { count: "exact", head: true })
      .eq("user_id", params.userId)
      .eq("action", params.action)
      .gt("points", 0);

    if (rule.max_per_user !== null && (lifetimeCount ?? 0) >= rule.max_per_user) {
      reason = "limit_reached";
    } else if (rule.cooldown_seconds > 0) {
      const { data: lastGrant } = await supabaseAdmin
        .from("reward_ledger")
        .select("created_at")
        .eq("user_id", params.userId)
        .eq("action", params.action)
        .gt("points", 0)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const cooledDownAt = lastGrant
        ? new Date(lastGrant.created_at).getTime() + rule.cooldown_seconds * 1000
        : 0;
      if (Date.now() < cooledDownAt) {
        reason = "cooldown_active";
      } else {
        points = rule.points;
      }
    } else {
      points = rule.points;
    }
  }

  const { error: insertError } = await supabaseAdmin.from("reward_ledger").insert({
    user_id: params.userId,
    action: params.action,
    points,
    resource_type: params.resourceType ?? null,
    resource_id: params.resourceId ?? null,
    source_app_id: params.sourceAppId ?? null,
    actor_user_id: params.actorUserId ?? params.userId,
    lifetime_points: params.lifetimePoints ?? points,
    origin: params.origin ?? "core",
    metadata: (params.metadata ?? {}) as Json,
    dedupe_key: params.dedupeKey ?? null,
  });
  if (insertError) {
    console.error("grantRewardAction: ledger insert failed", insertError);
    return { granted: false, points: 0, reason: "insert_failed" };
  }

  if (points > 0) {
    await checkAchievements(params.userId, params.action);
  }

  return { granted: points > 0, points, reason };
}

// Exported for events.server.ts's recordEvent() pipeline (Priority 12
// Phase 3) -- an event-driven grant completes the same achievements a
// CORE-internal action can, since both write the same reward_ledger.
export async function checkAchievements(userId: string, action: string): Promise<void> {
  const supabaseAdmin = await admin();
  const { data: achievements } = await supabaseAdmin
    .from("reward_achievements")
    .select("key, trigger_count")
    .eq("trigger_action", action)
    .eq("enabled", true)
    .eq("archived", false);
  if (!achievements || achievements.length === 0) return;

  const { count: actionCount } = await supabaseAdmin
    .from("reward_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gt("points", 0);

  for (const a of achievements) {
    if ((actionCount ?? 0) < a.trigger_count) continue;
    const { error } = await supabaseAdmin
      .from("user_achievements")
      .upsert(
        { user_id: userId, achievement_key: a.key },
        { onConflict: "user_id,achievement_key", ignoreDuplicates: true },
      );
    if (error) console.error("checkAchievements: upsert failed", a.key, error);
  }
}

export type RedeemCatalogRewardResult =
  | { ok: true; redemptionId: string; pointsSpent: number; fulfilled: boolean }
  | { ok: false; error: "reward_unavailable" | "insufficient_points" | "insufficient_referrals" };

// Priority 15 Phase C: the one place catalog redemption logic lives.
// Previously duplicated by hand between rewards.functions.ts's
// redeemReward (createServerFn) and src/routes/v1/me/rewards/redeem.ts (a
// /v1 HTTP route, which can't call a createServerFn directly) -- exactly
// the "two places compute the same answer differently" pattern CLAUDE.md
// calls a defect, found while fixing the redemption TOCTOU (C9). Both call
// sites now call this plain function instead, matching the existing
// *.server.ts (plain, callable from anywhere) / *.functions.ts
// (createServerFn wrapper) split. Atomic via redeem_reward_atomic()
// (service_role Postgres function, Phase C migration) -- see
// PROJECT_AUDIT.md -> PR11-13.
export async function redeemCatalogReward(params: {
  userId: string;
  catalogKey: string;
  appId?: string | null;
}): Promise<RedeemCatalogRewardResult> {
  const supabaseAdmin = await admin();

  const { data: item } = await supabaseAdmin
    .from("reward_catalog")
    .select("*")
    .eq("key", params.catalogKey)
    .eq("enabled", true)
    .eq("archived", false)
    .maybeSingle();
  if (!item) return { ok: false, error: "reward_unavailable" };

  if (item.requires_capability) {
    if (!params.appId) return { ok: false, error: "reward_unavailable" };
    const { getApplicationCapabilities } = await import("@/lib/capabilities.functions");
    const capabilityKeys = await getApplicationCapabilities({ data: { appId: params.appId } });
    if (!capabilityKeys.includes(item.requires_capability))
      return { ok: false, error: "reward_unavailable" };
  }

  const { count: verifiedReferrals } = await supabaseAdmin
    .from("premium_referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", params.userId)
    .not("verified_at", "is", null);

  const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc("redeem_reward_atomic", {
    p_user_id: params.userId,
    p_catalog_key: item.key,
    p_points_cost: item.points_cost,
    p_verified_referrals_required: item.verified_referrals_required,
    p_verified_referrals: verifiedReferrals ?? 0,
    p_grant_type: item.grant_type,
    p_grant_value: item.grant_value as Json,
  });
  if (rpcError) {
    console.error("redeemCatalogReward: redeem_reward_atomic failed", rpcError);
    return { ok: false, error: "reward_unavailable" };
  }
  const result = rpcRows?.[0];
  if (!result?.ok || !result.redemption_id) {
    return {
      ok: false,
      error:
        result?.error_code === "insufficient_referrals"
          ? "insufficient_referrals"
          : "insufficient_points",
    };
  }
  const redemptionId = result.redemption_id;

  // Actual fulfillment (extending Premium, crediting Advertising Credit)
  // routes through the same dispatcher Mission/Challenge/Streak
  // completions use -- not a second fulfillment mechanism.
  const { fulfillGrant } = await import("@/lib/entitlements.server");
  const fulfillment = await fulfillGrant({
    grantType: item.grant_type,
    grantValue: (item.grant_value ?? {}) as Record<string, unknown>,
    userId: params.userId,
    appId: params.appId ?? null,
    reason: `Reward redeemed: ${item.key}`,
    grantedBy: null,
    source: "reward_redemption",
  });
  if (fulfillment.status === "fulfilled") {
    await supabaseAdmin
      .from("reward_redemptions")
      .update({
        grant_result: {
          status: "fulfilled",
          grantType: item.grant_type,
          grantValue: item.grant_value,
          entitlementId: fulfillment.entitlementId ?? null,
        },
      })
      .eq("id", redemptionId);
  }

  const { writeAuditLog } = await import("@/lib/admin.server");
  await writeAuditLog({
    userId: params.userId,
    action: "reward.redeem",
    entityType: "reward_redemption",
    entityId: redemptionId,
    newData: {
      catalogKey: item.key,
      pointsCost: item.points_cost,
      fulfilled: fulfillment.status === "fulfilled",
    },
  });

  return {
    ok: true,
    redemptionId,
    pointsSpent: item.points_cost,
    fulfilled: fulfillment.status === "fulfilled",
  };
}

async function getVerificationDays(): Promise<number> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("reward_config")
    .select("value")
    .eq("key", "referral_verification_days")
    .maybeSingle();
  const value = data?.value;
  return typeof value === "number" ? value : 30;
}

// Called once, at the moment a user's Premium first becomes active (Stripe/
// PayPal fulfillment webhooks) -- records that this user was referred, if
// they were, so it can later be checked for verification. Does nothing if
// the user wasn't referred, or already has a referral record.
export async function recordPremiumReferralIfApplicable(params: {
  userId: string;
  subscriptionId: string | null;
}): Promise<void> {
  const supabaseAdmin = await admin();

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("referred_by_user_id")
    .eq("id", params.userId)
    .maybeSingle();
  if (!profile?.referred_by_user_id) return;

  const { data: existing } = await supabaseAdmin
    .from("premium_referrals")
    .select("id")
    .eq("referred_user_id", params.userId)
    .maybeSingle();
  if (existing) return;

  const verificationDays = await getVerificationDays();
  const verificationDueAt = new Date(Date.now() + verificationDays * 24 * 60 * 60 * 1000);

  const { error } = await supabaseAdmin.from("premium_referrals").insert({
    referrer_id: profile.referred_by_user_id,
    referred_user_id: params.userId,
    subscription_id: params.subscriptionId,
    verification_due_at: verificationDueAt.toISOString(),
  });
  if (error) console.error("recordPremiumReferralIfApplicable: insert failed", error);
}

// Lazily evaluated (this codebase has no cron infrastructure -- matches
// the existing precedent of trial activation being checked reactively on
// dashboard load, not on a schedule): checks this referrer's own pending
// referrals whose verification period has elapsed, and promotes/rewards
// any where the referred user's Premium is still active right now.
//
// Known, deliberate simplification: this checks "is Premium active at the
// moment the period elapses," not "was Premium continuously active for
// the whole period" -- building true continuous-activity tracking would
// require a subscription status history this codebase doesn't keep.
export async function promotePendingReferralVerifications(referrerId: string): Promise<void> {
  const supabaseAdmin = await admin();
  const { data: pending } = await supabaseAdmin
    .from("premium_referrals")
    .select("id, referred_user_id")
    .eq("referrer_id", referrerId)
    .is("verified_at", null)
    .lte("verification_due_at", new Date().toISOString());
  if (!pending || pending.length === 0) return;

  for (const referral of pending) {
    const stillActive = await hasAnyActivePremium(referral.referred_user_id);
    if (!stillActive) continue;
    const { error } = await supabaseAdmin
      .from("premium_referrals")
      .update({ verified_at: new Date().toISOString() })
      .eq("id", referral.id);
    if (error) {
      console.error("promotePendingReferralVerifications: update failed", error);
      continue;
    }
    await grantRewardAction({
      userId: referrerId,
      action: "premium_referral_verified",
      resourceType: "user",
      resourceId: referral.referred_user_id,
    });
  }
}
