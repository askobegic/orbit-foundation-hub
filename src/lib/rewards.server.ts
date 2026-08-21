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
import { sendNotification } from "@/lib/notify.server";
import type { Json } from "@/integrations/supabase/types";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// Priority 16: mirrors events.server.ts's countSince() exactly -- the two
// reward engines stay deliberately parallel (Phase A audit finding), not
// merged, so this is a small, intentional duplication rather than a
// shared import across them.
async function countActionSince(
  supabaseAdmin: Awaited<ReturnType<typeof admin>>,
  userId: string,
  action: string,
  since: Date,
): Promise<number> {
  const { count } = await supabaseAdmin
    .from("reward_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gt("points", 0)
    .gte("created_at", since.toISOString());
  return count ?? 0;
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
  origin?: "core" | "application" | "api" | "n8n" | "manual_admin" | "system" | "refund_reversal"; // defaults to "core"
  metadata?: Record<string, unknown>; // defaults to {}
  dedupeKey?: string | null;
  // Priority 16: server-verified EUR amount, required only for a rule
  // configured with points_per_euro (a proportional rule). Ignored by
  // flat-rate rules. Callers must resolve this from a webhook-verified
  // payment amount only -- never a client-supplied value.
  amountEur?: number;
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
      }
    }

    // Priority 16: daily/weekly/monthly caps -- mirrors event_rules'
    // exact semantics (Priority 12), now also available to CORE-internal
    // actions. Only checked once the checks above pass, matching
    // recordEvent()'s own ordering.
    if (!reason && rule.daily_limit !== null) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (
        (await countActionSince(supabaseAdmin, params.userId, params.action, since)) >=
        rule.daily_limit
      ) {
        reason = "daily_limit_reached";
      }
    }
    if (!reason && rule.weekly_limit !== null) {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (
        (await countActionSince(supabaseAdmin, params.userId, params.action, since)) >=
        rule.weekly_limit
      ) {
        reason = "weekly_limit_reached";
      }
    }
    if (!reason && rule.monthly_limit !== null) {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      if (
        (await countActionSince(supabaseAdmin, params.userId, params.action, since)) >=
        rule.monthly_limit
      ) {
        reason = "monthly_limit_reached";
      }
    }

    if (!reason) {
      // Priority 16: a proportional rule (points_per_euro set) computes
      // its points from the server-verified paid amount instead of the
      // flat `points` column. A proportional rule called without an
      // amount is a caller bug, not a silent 0 -- it's reported as its
      // own distinct reason rather than granting nothing unexplained.
      if (rule.points_per_euro !== null) {
        if (params.amountEur === undefined || params.amountEur === null) {
          reason = "amount_required";
        } else {
          points = Math.floor(params.amountEur * Number(rule.points_per_euro));
        }
      } else {
        points = rule.points;
      }

      // Priority 17: Reward Boosts -- a temporary multiplier on this
      // action, applied here (the one place points are ever decided for
      // CORE-internal actions) rather than as a second calculation path.
      // Final business rule (pre-production audit): overlapping windows
      // for the same action are rejected at write time by
      // adminUpsertRewardBoost, so at most one boost should ever match
      // here -- no stacking, ever. The explicit ORDER BY is defense in
      // depth for the boundary instant where one window's ends_at equals
      // another's starts_at (both inclusive bounds below), making
      // resolution deterministic (most recently started wins) rather
      // than left to whatever order the database happens to return.
      if (points > 0) {
        const now = new Date().toISOString();
        const { data: boost } = await supabaseAdmin
          .from("reward_boosts")
          .select("multiplier")
          .eq("action", params.action)
          .eq("enabled", true)
          .eq("archived", false)
          .lte("starts_at", now)
          .gte("ends_at", now)
          .order("starts_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (boost) {
          points = Math.floor(points * Number((boost as { multiplier: number }).multiplier));
        }
      }
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
    // A dedupe_key collision means this exact grant was already recorded
    // -- the expected outcome of a retried/redelivered call, not a real
    // error (same precedent as events.server.ts's recordEvent()).
    if (insertError.code === "23505") {
      return { granted: false, points: 0, reason: "duplicate" };
    }
    console.error("grantRewardAction: ledger insert failed", insertError);
    return { granted: false, points: 0, reason: "insert_failed" };
  }

  if (points > 0) {
    await checkAchievements(params.userId, params.action);
    await evaluatePremiumMilestones(params.userId);
  }

  return { granted: points > 0, points, reason };
}

// CORE Rewards / Points Purchase: grants Points for a verified Points
// Package purchase. Deliberately NOT routed through grantRewardAction() --
// that function's entire design is "look up a configured value for a
// known action key" (reward_action_rules), but a points purchase's amount
// is decided by which package was bought, already resolved by the caller
// from the points_packages row itself (never a client-supplied value).
// `resourceType: "payment"`/`resourceId: paymentId` is what makes
// reversePaymentPoints() (below) already reverse this automatically on a
// Stripe/PayPal refund -- no new reversal code needed for Points Purchase.
export async function grantPurchasedPoints(params: {
  userId: string;
  points: number;
  paymentId: string;
  packageId: string;
  sourceAppId: string | null;
  dedupeKey: string;
}): Promise<{ granted: boolean; reason?: string }> {
  const supabaseAdmin = await admin();

  const { error } = await supabaseAdmin.from("reward_ledger").insert({
    user_id: params.userId,
    action: "points_purchased",
    points: params.points,
    lifetime_points: params.points,
    resource_type: "payment",
    resource_id: params.paymentId,
    source_app_id: params.sourceAppId,
    actor_user_id: params.userId,
    origin: "points_purchase",
    metadata: { packageId: params.packageId } as Json,
    dedupe_key: params.dedupeKey,
  });
  if (error) {
    if (error.code === "23505") return { granted: false, reason: "duplicate" };
    console.error("grantPurchasedPoints: ledger insert failed", error);
    return { granted: false, reason: "insert_failed" };
  }

  if (params.points > 0) {
    await checkAchievements(params.userId, "points_purchased");
    await evaluatePremiumMilestones(params.userId);
  }

  return { granted: true };
}

// Exported for events.server.ts's recordEvent() pipeline (Priority 12
// Phase 3) -- an event-driven grant completes the same achievements a
// CORE-internal action can, since both write the same reward_ledger.
export async function checkAchievements(userId: string, action: string): Promise<void> {
  const supabaseAdmin = await admin();
  const { data: achievements } = await supabaseAdmin
    .from("reward_achievements")
    .select("key, label, trigger_count")
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
    // .select() after an ignoreDuplicates upsert returns a row only when
    // the insert actually happened (Postgres's ON CONFLICT DO NOTHING
    // omits conflicting rows from RETURNING) -- the same signal
    // evaluatePremiumMilestones already relies on below to notify only on
    // a genuinely new milestone, not every time this runs.
    const { data: inserted, error } = await supabaseAdmin
      .from("user_achievements")
      .upsert(
        { user_id: userId, achievement_key: a.key },
        { onConflict: "user_id,achievement_key", ignoreDuplicates: true },
      )
      .select("achievement_key");
    if (error) {
      console.error("checkAchievements: upsert failed", a.key, error);
      continue;
    }
    if (!inserted || inserted.length === 0) continue; // already earned

    await sendNotification({
      userId,
      category: "reward",
      type: "success",
      targetPath: "/dashboard/rewards",
      dedupeKey: `achievement:${userId}:${a.key}`,
      content: {
        titleBs: "Postignuće otključano!",
        titleEn: "Achievement unlocked!",
        titleDe: "Erfolg freigeschaltet!",
        messageBs: a.label,
        messageEn: a.label,
        messageDe: a.label,
      },
    });
  }
}

// Priority 16: Premium Milestones -- lazily evaluated wherever points are
// granted (this function, and events.server.ts's recordEvent(), call it
// right alongside checkAchievements(), the exact same "check thresholds
// after any point grant" pattern). Dual-metric: lifetime points (never
// decreases, same figure reward_levels already tiers on) AND successful
// invites (registered + completed profile, computed live from
// profiles.referred_by_user_id + profile_complete -- no stored counter,
// consistent with this codebase's existing preference). A milestone is
// granted at most once per user via UNIQUE(user_id, milestone_id) +
// upsert-ignoreDuplicates, the same idempotency pattern
// user_achievements/user_streak_milestones already use. Fulfillment
// reuses fulfillGrant() -- the same dispatcher Missions/Challenges/
// Streaks/catalog redemption already share -- never a separate Premium
// grant path.
export async function evaluatePremiumMilestones(userId: string): Promise<void> {
  const supabaseAdmin = await admin();

  const [{ data: ledgerRows }, { count: successfulInvites }, { data: milestones }] =
    await Promise.all([
      supabaseAdmin.from("reward_ledger").select("lifetime_points").eq("user_id", userId),
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("referred_by_user_id", userId)
        .eq("profile_complete", true),
      supabaseAdmin
        .from("reward_milestones")
        .select("*")
        .eq("enabled", true)
        .eq("archived", false)
        .order("min_lifetime_points", { ascending: true }),
    ]);
  if (!milestones || milestones.length === 0) return;

  const lifetimePoints = (ledgerRows ?? []).reduce((sum, r) => sum + r.lifetime_points, 0);
  const invites = successfulInvites ?? 0;

  for (const milestone of milestones) {
    if (
      lifetimePoints < milestone.min_lifetime_points ||
      invites < milestone.min_successful_invites
    ) {
      continue;
    }

    const { data: inserted, error } = await supabaseAdmin
      .from("user_reward_milestones")
      .upsert(
        { user_id: userId, milestone_id: milestone.id },
        { onConflict: "user_id,milestone_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("evaluatePremiumMilestones: completion insert failed", milestone.key, error);
      continue;
    }
    if (!inserted) continue; // already granted

    const { fulfillGrant } = await import("@/lib/entitlements.server");
    const grantValue = (milestone.grant_value ?? {}) as Record<string, unknown>;
    const fulfillment = await fulfillGrant({
      grantType: milestone.grant_type,
      grantValue,
      userId,
      appId: null,
      reason: `Premium milestone reached: ${milestone.key}`,
      grantedBy: null,
      source: "premium_milestone",
    });

    await supabaseAdmin
      .from("user_reward_milestones")
      .update({
        grant_result: {
          status: fulfillment.status,
          grantType: milestone.grant_type,
          grantValue: grantValue as Json,
          entitlementId: fulfillment.entitlementId ?? null,
        },
      })
      .eq("user_id", userId)
      .eq("milestone_id", milestone.id);

    await sendNotification({
      userId,
      category: "premium",
      type: "success",
      targetPath: "/dashboard/rewards",
      dedupeKey: `premium_milestone:${userId}:${milestone.id}`,
      content: {
        titleBs: "Premium prekretnica dostignuta!",
        titleEn: "Premium milestone reached!",
        titleDe: "Premium-Meilenstein erreicht!",
        messageBs: milestone.label,
        messageEn: milestone.label,
        messageDe: milestone.label,
      },
    });
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

// Priority 16: automatic refund/reversal (Phase A audit gap PR16-1 --
// refunded purchases previously kept every point). Called only from the
// Stripe/PayPal refund webhook handlers, never client- or admin-invoked
// -- deliberately NOT the manual-admin-adjustment path (origin=
// 'manual_admin' requires a human-authored `reason`; this is a
// non-discretionary automatic system reaction, kept distinguishable via
// its own origin, 'refund_reversal').
//
// Financial grants are looked up by resource_type='payment' +
// resource_id=paymentId (both webhooks now set this on the original
// grant, replacing the previous subscription/campaign id) rather than by
// dedupe_key, since a payment can have more than one financial grant
// row across its lifetime otherwise there'd be nothing to sum.
//
// Idempotent per caller-supplied dedupeKey (the Stripe/PayPal event's own
// id) -- a redelivered webhook produces the exact same dedupe_key and is
// rejected by the same unique index every other dedupe_key use relies on.
// Reversal is capped at whatever remains ungranted so far (originalPoints
// minus already-reversed), so a sequence of partial refunds can never
// reverse more than was originally granted, and a redelivered/duplicate
// event that still slips past the dedupe check computes a zero delta and
// is a safe no-op.
export async function reversePaymentPoints(params: {
  paymentId: string;
  userId: string;
  sourceAppId: string | null;
  // The amount to reverse right now (already resolved by the caller from
  // provider-specific webhook data -- Stripe's cumulative amount_refunded
  // vs PayPal's discrete per-refund amount need different delta logic
  // upstream; this function only ever applies a final, resolved amount).
  refundedAmountEurNow: number;
  dedupeKey: string;
}): Promise<{ ok: boolean; reversedPoints: number; reason?: string }> {
  const supabaseAdmin = await admin();

  const { data: grantRows, error: grantErr } = await supabaseAdmin
    .from("reward_ledger")
    .select("points")
    .eq("resource_type", "payment")
    .eq("resource_id", params.paymentId)
    .neq("origin", "refund_reversal")
    .gt("points", 0);
  if (grantErr) {
    console.error("reversePaymentPoints: original grant lookup failed", grantErr);
    return { ok: false, reversedPoints: 0, reason: "lookup_failed" };
  }
  const originalPoints = (grantRows ?? []).reduce((sum, r) => sum + r.points, 0);
  if (originalPoints <= 0) {
    return { ok: true, reversedPoints: 0, reason: "no_original_grant" };
  }

  const { data: paymentRow } = await supabaseAdmin
    .from("payments")
    .select("amount, currency")
    .eq("id", params.paymentId)
    .maybeSingle();
  if (
    !paymentRow ||
    (paymentRow.currency ?? "").toUpperCase() !== "EUR" ||
    !(paymentRow.amount > 0)
  ) {
    return { ok: true, reversedPoints: 0, reason: "not_eur_or_zero_amount" };
  }
  const effectiveRate = originalPoints / paymentRow.amount;

  const { data: reversalRows, error: reversalErr } = await supabaseAdmin
    .from("reward_ledger")
    .select("points")
    .eq("resource_type", "payment")
    .eq("resource_id", params.paymentId)
    .eq("origin", "refund_reversal");
  if (reversalErr) {
    console.error("reversePaymentPoints: prior reversal lookup failed", reversalErr);
    return { ok: false, reversedPoints: 0, reason: "lookup_failed" };
  }
  const alreadyReversed = Math.abs((reversalRows ?? []).reduce((sum, r) => sum + r.points, 0));
  const remaining = originalPoints - alreadyReversed;
  if (remaining <= 0) {
    return { ok: true, reversedPoints: 0, reason: "fully_reversed_already" };
  }

  const pointsToReverseNow = Math.min(
    remaining,
    Math.floor(params.refundedAmountEurNow * effectiveRate),
  );
  if (pointsToReverseNow <= 0) {
    return { ok: true, reversedPoints: 0, reason: "nothing_new_to_reverse" };
  }

  const { error: insertErr } = await supabaseAdmin.from("reward_ledger").insert({
    user_id: params.userId,
    action: "refund_reversal",
    points: -pointsToReverseNow,
    lifetime_points: -pointsToReverseNow,
    resource_type: "payment",
    resource_id: params.paymentId,
    source_app_id: params.sourceAppId,
    actor_user_id: params.userId,
    origin: "refund_reversal",
    metadata: {
      originalPoints,
      alreadyReversedBefore: alreadyReversed,
      refundedAmountEurNow: params.refundedAmountEurNow,
      effectiveRate,
    } as Json,
    dedupe_key: params.dedupeKey,
  });
  if (insertErr) {
    if (insertErr.code === "23505") {
      return { ok: true, reversedPoints: 0, reason: "duplicate" };
    }
    console.error("reversePaymentPoints: reversal insert failed", insertErr);
    return { ok: false, reversedPoints: 0, reason: "insert_failed" };
  }

  return { ok: true, reversedPoints: pointsToReverseNow };
}
