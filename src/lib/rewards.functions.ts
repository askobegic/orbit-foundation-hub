// Priority 8.3: Rewards & Loyalty -- public server-function surface.
//
// Reward processing itself lives in rewards.server.ts; this file is the
// createServerFn-wrapped API other code (and, eventually, the /v1 API in
// Phase 8.5) calls directly. See PROJECT_KNOWLEDGE.md -> Rewards & Loyalty.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import {
  grantRewardAction,
  promotePendingReferralVerifications,
  redeemCatalogReward,
} from "@/lib/rewards.server";

// ---------- Priority 16: onboarding + referral submission rewards ----------

// Called once from onboarding.tsx's completion handler -- registration and
// profile completion happen in the same one-time flow in this app today,
// so both CORE-internal actions are granted together here. Idempotent via
// grantRewardAction()'s own max_per_user=1 (the primary guard) plus a
// defensive dedupeKey (in case the client retries before its local
// profile_complete state updates). If the completing user was themselves
// directly referred, their referrer is rewarded too (once per invited
// user, by construction: this can only run once per invited user, since
// it's called from that user's own one-time onboarding completion) --
// never a chain: only profiles.referred_by_user_id (one level) is read.
export const completeOnboardingRewards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabaseAdmin = await adminClient();

    await grantRewardAction({
      userId: context.userId,
      action: "registration",
      dedupeKey: `registration:${context.userId}`,
    });
    await grantRewardAction({
      userId: context.userId,
      action: "profile_completed",
      dedupeKey: `profile_completed:${context.userId}`,
    });

    const { data: me } = await supabaseAdmin
      .from("profiles")
      .select("referred_by_user_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (me?.referred_by_user_id) {
      await grantRewardAction({
        userId: me.referred_by_user_id,
        action: "referral_profile_completed",
        resourceType: "user",
        resourceId: context.userId,
        dedupeKey: `referral_profile_completed:${context.userId}`,
      });
    }

    return { ok: true };
  });

// The smallest secure, server-observable "referral submission" signal:
// called when the user actually performs a share/invite action (copy
// link or native share) from their own Dashboard Invite panel --
// ShareAndInvite.tsx, never a per-click UI-only event. Rate-limited via
// the SAME reward_action_rules mechanism as every other CORE-internal
// action (cooldown_seconds guards rapid re-submission of one action;
// daily_limit is the approved "max 3/day" cap) -- not a second rate-limit
// system. No target/recipient is captured at this step (a native share
// sheet reports no delivery outcome), so there is nothing here for
// self-referral to apply to; self-referral is guarded where it actually
// matters, at linkReferral() below, when a real second party links back.
export const recordReferralSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const result = await grantRewardAction({
      userId: context.userId,
      action: "referral_submission",
    });
    return { ok: result.granted, reason: result.reason };
  });

async function computeBalance(userId: string, supabase: Awaited<ReturnType<typeof adminClient>>) {
  const [{ data: ledgerRows }, { data: redemptionRows }] = await Promise.all([
    supabase.from("reward_ledger").select("points, lifetime_points").eq("user_id", userId),
    supabase.from("reward_redemptions").select("points_spent").eq("user_id", userId),
  ]);
  // Priority 12: Lifetime Points and Reward Points are independent
  // columns as of the Phase 1 migration (lifetime_points defaults equal
  // to points for every row, so this is unchanged for any user not
  // touched by a rule/adjustment that deliberately diverges them).
  // Reward (spendable) Points still derive from `points`, exactly as
  // before -- only the Lifetime figure's source column changed.
  const spendablePoints = (ledgerRows ?? []).reduce((sum, r) => sum + r.points, 0);
  const lifetimePoints = (ledgerRows ?? []).reduce((sum, r) => sum + r.lifetime_points, 0);
  const redeemedPoints = (redemptionRows ?? []).reduce((sum, r) => sum + r.points_spent, 0);
  return { lifetimePoints, rewardPoints: spendablePoints - redeemedPoints };
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const getRewardsMeSchema = z.object({ appId: z.string().uuid().optional() });

// Aggregated Rewards Dashboard data -- one call, matching the "aggregate,
// don't mirror tables" principle already established for GET /v1/me and
// GET /v1/profiles/:username. appId is optional -- when the caller has no
// resolved application context, catalog items are not filtered by
// requires_capability at all (same "no application context = don't hide
// anything" fallback used by DashboardPage.tsx's isWidgetEnabled).
export const getRewardsMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => getRewardsMeSchema.parse(raw))
  .handler(async ({ data, context }) => {
    // Lazy verification check -- see rewards.server.ts for why this isn't
    // a scheduled job.
    await promotePendingReferralVerifications(context.userId);

    const { lifetimePoints, rewardPoints } = await computeBalance(context.userId, context.supabase);

    const [
      { data: levels },
      { data: achievementRows },
      { data: catalogRows },
      { count: verifiedReferrals },
      { data: redemptions },
    ] = await Promise.all([
      context.supabase
        .from("reward_levels")
        .select("*")
        .eq("enabled", true)
        .eq("archived", false)
        .lte("min_lifetime_points", lifetimePoints)
        .order("min_lifetime_points", { ascending: false })
        .limit(1),
      context.supabase
        .from("user_achievements")
        .select("achievement_key, earned_at, reward_achievements(label, description)")
        .eq("user_id", context.userId)
        .order("earned_at", { ascending: false }),
      context.supabase
        .from("reward_catalog")
        .select("*")
        .eq("enabled", true)
        .eq("archived", false)
        .order("display_order", { ascending: true }),
      context.supabase
        .from("premium_referrals")
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", context.userId)
        .not("verified_at", "is", null),
      context.supabase
        .from("reward_redemptions")
        .select("*")
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const verifiedReferralsCount = verifiedReferrals ?? 0;

    // Global Points, broken down per application (Priority 12 Phase 5) --
    // a read-only aggregation over the same source_app_id column every
    // grant has always recorded, not a new balance concept: rewardPoints
    // above remains the one global, spendable total. Bounded to this
    // caller's own ledger, so grouping in JS (rather than a DB-side
    // aggregate function, which the cross-user admin analytics below
    // need instead) is safe and avoids a second RPC round-trip.
    const { data: ledgerByApp } = await context.supabase
      .from("reward_ledger")
      .select("source_app_id, points")
      .eq("user_id", context.userId);
    const pointsByAppId = new Map<string | null, number>();
    for (const row of ledgerByApp ?? []) {
      const key = row.source_app_id;
      pointsByAppId.set(key, (pointsByAppId.get(key) ?? 0) + row.points);
    }
    const appIds = [...pointsByAppId.keys()].filter((id): id is string => id !== null);
    const { data: appRows } = appIds.length
      ? await context.supabase.from("applications").select("id, name").in("id", appIds)
      : { data: [] };
    const appNameById = new Map((appRows ?? []).map((a) => [a.id, a.name]));
    const pointsByApp = [...pointsByAppId.entries()].map(([appId, points]) => ({
      appId,
      appName: appId ? (appNameById.get(appId) ?? null) : "core",
      points,
    }));

    // Dependency validation (adjustment, Priority 8.3 follow-up): a
    // catalog item with requires_capability set is only shown when that
    // capability is enabled for the caller's current application. With no
    // appId (no resolved application context), nothing is filtered out.
    const capabilityKeys = data.appId
      ? new Set(await getApplicationCapabilities({ data: { appId: data.appId } }))
      : null;
    const visibleCatalogRows = (catalogRows ?? []).filter(
      (c) => !c.requires_capability || !capabilityKeys || capabilityKeys.has(c.requires_capability),
    );

    return {
      rewardPoints,
      lifetimePoints,
      pointsByApp,
      level: levels?.[0]
        ? { key: levels[0].key, label: levels[0].label }
        : { key: "member", label: "Member" },
      verifiedReferrals: verifiedReferralsCount,
      achievements: (achievementRows ?? []).map((a) => ({
        key: a.achievement_key,
        label: a.reward_achievements?.label ?? a.achievement_key,
        description: a.reward_achievements?.description ?? null,
        earnedAt: a.earned_at,
      })),
      catalog: visibleCatalogRows.map((c) => ({
        key: c.key,
        label: c.label,
        description: c.description,
        pointsCost: c.points_cost,
        verifiedReferralsRequired: c.verified_referrals_required,
        grantType: c.grant_type,
        canRedeem:
          rewardPoints >= c.points_cost && verifiedReferralsCount >= c.verified_referrals_required,
      })),
      redeemHistory: (redemptions ?? []).map((r) => ({
        catalogKey: r.catalog_key,
        pointsSpent: r.points_spent,
        redeemedAt: r.created_at,
        status: (r.grant_result as { status?: string } | null)?.status ?? "pending_fulfillment",
      })),
    };
  });

const redeemSchema = z.object({ catalogKey: z.string(), appId: z.string().uuid().optional() });

export const redeemReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => redeemSchema.parse(raw))
  .handler(async ({ data, context }) => {
    // Priority 15 Phase C (C8 / PR11-20): a reward-sensitive endpoint,
    // rate limited per user -- generous for legitimate use (redemptions
    // are rare relative to browsing), tight enough to block a scripted
    // redeem loop. Reuses the existing in-memory limiter (Priority 11
    // security audit), not a second mechanism.
    enforceRateLimit(`redeem-reward:${context.userId}`, 10, 60 * 1000);

    // All validation, the atomic balance-check-and-insert (C9 / PR11-13),
    // and fulfillment dispatch live in redeemCatalogReward()
    // (rewards.server.ts) -- shared with the /v1/me/rewards/redeem HTTP
    // route, which previously duplicated this logic by hand.
    const result = await redeemCatalogReward({
      userId: context.userId,
      catalogKey: data.catalogKey,
      appId: data.appId ?? null,
    });
    if (!result.ok) {
      if (result.error === "insufficient_points") throw new Error("Not enough Reward Points");
      if (result.error === "insufficient_referrals")
        throw new Error("Not enough Verified Premium Referrals");
      throw new Error("Reward not found or unavailable");
    }

    return { ok: true };
  });

const linkReferralSchema = z.object({ referrerUsername: z.string().trim().min(1) });

// Links the calling user to the referrer who invited them (captured
// client-side from a `?ref=<username>` link -- see referral.ts) and
// credits the referrer's invite_registration action. Deliberately
// service-role only: profiles.referred_by_user_id is not in the
// authenticated column grant (see protect_profile_privileged_columns
// migration), because letting a user set their own referrer directly
// would let them fabricate referrals for reward fraud. First-write-only
// and self-referral is rejected.
export const linkReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => linkReferralSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await adminClient();

    const { data: me } = await supabaseAdmin
      .from("profiles")
      .select("referred_by_user_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (me?.referred_by_user_id) return { ok: false, reason: "already_linked" as const };

    const { data: referrer } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("username", data.referrerUsername)
      .maybeSingle();
    if (!referrer) return { ok: false, reason: "referrer_not_found" as const };
    if (referrer.id === context.userId) return { ok: false, reason: "self_referral" as const };

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ referred_by_user_id: referrer.id })
      .eq("id", context.userId)
      .is("referred_by_user_id", null);
    if (error) throw new Error(error.message);

    await grantRewardAction({
      userId: referrer.id,
      action: "invite_registration",
      resourceType: "user",
      resourceId: context.userId,
    });

    return { ok: true as const };
  });

// ---------- Admin: registry CRUD (same shape as capabilities/dashboard widgets) ----------

const actionRuleSchema = z.object({
  id: z.string().uuid().optional(),
  action: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  points: z.number().int().min(0),
  cooldownSeconds: z.number().int().min(0).default(0),
  maxPerUser: z.number().int().min(1).nullable().optional(),
  dailyLimit: z.number().int().min(1).nullable().optional(),
  weeklyLimit: z.number().int().min(1).nullable().optional(),
  monthlyLimit: z.number().int().min(1).nullable().optional(),
  pointsPerEuro: z.number().min(0).nullable().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertRewardActionRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => actionRuleSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("reward_action_rules")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      action: data.action,
      label: data.label,
      points: data.points,
      cooldown_seconds: data.cooldownSeconds,
      max_per_user: data.maxPerUser ?? null,
      daily_limit: data.dailyLimit ?? null,
      weekly_limit: data.weeklyLimit ?? null,
      monthly_limit: data.monthlyLimit ?? null,
      points_per_euro: data.pointsPerEuro ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("reward_action_rules")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("reward_action_rules").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "reward_action_rule.update" : "reward_action_rule.create",
      entityType: "reward_action_rule",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListRewardActionRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("reward_action_rules")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const levelSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  minLifetimePoints: z.number().int().min(0).default(0),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertRewardLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => levelSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("reward_levels")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      key: data.key,
      label: data.label,
      min_lifetime_points: data.minLifetimePoints,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("reward_levels")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("reward_levels").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "reward_level.update" : "reward_level.create",
      entityType: "reward_level",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListRewardLevels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("reward_levels")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const achievementSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  // References reward_action_rules.action -- an achievement is earned by
  // reaching triggerCount occurrences of that action (see rewards.server.ts).
  // Nullable: an achievement not tied to any action rule is never
  // auto-awarded, only ever granted manually/by a future mechanism.
  triggerAction: z.string().trim().nullable().optional(),
  triggerCount: z.number().int().min(1).default(1),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertRewardAchievement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => achievementSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("reward_achievements")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      key: data.key,
      label: data.label,
      description: data.description ?? null,
      trigger_action: data.triggerAction ?? null,
      trigger_count: data.triggerCount,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("reward_achievements")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("reward_achievements").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "reward_achievement.update" : "reward_achievement.create",
      entityType: "reward_achievement",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListRewardAchievements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("reward_achievements")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// Fulfillment types (adjustment, Priority 8.3 follow-up): a registry,
// exactly like capability_definitions, rather than a fixed literal union
// -- so a later module (Advertising, or anything after it) can register
// its own fulfillment type without a CORE deployment. Rewards records
// which type a redemption needs; it is never responsible for acting on
// it -- that stays with whichever module owns that type.
const fulfillmentTypeSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertRewardFulfillmentType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => fulfillmentTypeSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("reward_fulfillment_types")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      key: data.key,
      label: data.label,
      description: data.description ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("reward_fulfillment_types")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("reward_fulfillment_types").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "reward_fulfillment_type.update" : "reward_fulfillment_type.create",
      entityType: "reward_fulfillment_type",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListRewardFulfillmentTypes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("reward_fulfillment_types")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const catalogSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  pointsCost: z.number().int().min(0),
  verifiedReferralsRequired: z.number().int().min(0).default(0),
  // Validated against reward_fulfillment_types by DB foreign key, not a
  // hardcoded enum here -- see the comment above fulfillmentTypeSchema.
  grantType: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  grantValue: z.record(z.string(), z.unknown()).default({}),
  // Dependency validation (adjustment): hides this reward from
  // getRewardsMe's catalog automatically when the named capability is
  // disabled for the caller's application -- same mechanism as
  // dashboard_widgets.requiresCapability.
  requiresCapability: z.string().trim().nullable().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertRewardCatalogItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => catalogSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("reward_catalog")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      key: data.key,
      label: data.label,
      description: data.description ?? null,
      points_cost: data.pointsCost,
      verified_referrals_required: data.verifiedReferralsRequired,
      grant_type: data.grantType,
      grant_value: data.grantValue as Json,
      requires_capability: data.requiresCapability ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("reward_catalog")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("reward_catalog").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "reward_catalog.update" : "reward_catalog.create",
      entityType: "reward_catalog",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListRewardCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("reward_catalog")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminListRewardConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("reward_config")
      .select("*")
      .order("key", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const configSchema = z.object({
  key: z.string().trim().min(1),
  value: z.unknown(),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetRewardConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => configSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("reward_config")
      .select("value")
      .eq("key", data.key)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("reward_config")
      .upsert({ key: data.key, value: data.value as Json, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "reward_config.set",
      entityType: "reward_config",
      entityId: data.key,
      oldData: previous?.value ?? null,
      newData: data.value,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

// ---------- Admin: manual reward adjustments (Priority 12 Phase 4) ----------

const adjustRewardPointsSchema = z.object({
  userId: z.string().uuid(),
  points: z
    .number()
    .int()
    .refine((v) => v !== 0, "points must be nonzero"),
  // Independent from `points` (Priority 12 decision 1), same as every
  // other ledger-writing path -- defaults to equal `points` unless an
  // admin deliberately diverges them.
  lifetimePoints: z.number().int().optional(),
  // Mandatory, unlike every other admin mutation's optional `reason` --
  // an explicit user requirement for this specific action, since it's the
  // one path that can move a user's balance without any underlying
  // action having actually happened.
  reason: z.string().trim().min(1).max(500),
});

// The one path that can write a negative points/lifetime_points row --
// enforced at the database level by reward_ledger_points_nonneg_check,
// which only permits negative values when origin = 'manual_admin' (see
// the Phase 1 migration). Every other origin keeps the non-negative
// guarantee untouched.
export const adminAdjustRewardPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => adjustRewardPointsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const lifetimePoints = data.lifetimePoints ?? data.points;

    const { data: row, error } = await supabaseAdmin
      .from("reward_ledger")
      .insert({
        user_id: data.userId,
        action: "manual_adjustment",
        points: data.points,
        lifetime_points: lifetimePoints,
        actor_user_id: context.userId,
        origin: "manual_admin",
        metadata: {},
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "reward_ledger.manual_adjustment",
      entityType: "reward_ledger",
      entityId: row.id,
      newData: { targetUserId: data.userId, points: data.points, lifetimePoints },
      reason: data.reason,
    });
    return { ok: true, points: data.points, lifetimePoints };
  });

// Priority 16 Phase D1: read-only per-user Reward Ledger for the Admin
// User 360 modal -- reuses computeBalance() (the exact same balance
// formula the user's own Rewards Dashboard already shows, Priority 8.3)
// instead of a second balance calculation, and reads reward_ledger
// directly rather than introducing any new table. `reason` isn't a
// reward_ledger column -- for manual_admin rows (the only origin that
// ever carries a human-authored reason) it lives on the matching
// audit_logs row (adminAdjustRewardPoints writes it there), so it's
// joined in here by entity_id rather than duplicated onto the ledger.
export const adminListUserRewardLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ userId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const [balance, { data: ledgerRows, error }, { data: apps }] = await Promise.all([
      computeBalance(data.userId, supabaseAdmin),
      supabaseAdmin
        .from("reward_ledger")
        .select(
          "id, action, points, lifetime_points, resource_type, resource_id, source_app_id, origin, actor_user_id, metadata, created_at",
        )
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin.from("applications").select("id, name"),
    ]);
    if (error) throw new Error(error.message);

    const manualIds = (ledgerRows ?? [])
      .filter((r) => r.origin === "manual_admin")
      .map((r) => r.id);
    let reasonByLedgerId = new Map<string, string | null>();
    if (manualIds.length > 0) {
      const { data: auditRows } = await supabaseAdmin
        .from("audit_logs")
        .select("entity_id, reason")
        .eq("entity_type", "reward_ledger")
        .in("entity_id", manualIds);
      reasonByLedgerId = new Map(
        (auditRows ?? []).map((a) => [a.entity_id as string, a.reason as string | null]),
      );
    }

    const appNameById = new Map((apps ?? []).map((a) => [a.id, a.name]));

    return {
      lifetimePoints: balance.lifetimePoints,
      rewardPoints: balance.rewardPoints,
      entries: (ledgerRows ?? []).map((r) => ({
        id: r.id,
        action: r.action,
        points: r.points,
        lifetimePoints: r.lifetime_points,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        appName: r.source_app_id ? (appNameById.get(r.source_app_id) ?? "?") : null,
        origin: r.origin,
        actorUserId: r.actor_user_id,
        reason: reasonByLedgerId.get(r.id) ?? null,
        createdAt: r.created_at,
      })),
    };
  });

// ---------- Admin: Premium Milestones (Priority 16) ----------
// Same registry CRUD shape as reward_levels/reward_catalog above.

const milestoneSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(200),
  minLifetimePoints: z.number().int().min(0),
  minSuccessfulInvites: z.number().int().min(0).default(0),
  grantType: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  grantValue: z.record(z.string(), z.unknown()).default({}),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertRewardMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => milestoneSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("reward_milestones")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      key: data.key,
      label: data.label,
      min_lifetime_points: data.minLifetimePoints,
      min_successful_invites: data.minSuccessfulInvites,
      grant_type: data.grantType,
      grant_value: data.grantValue as Json,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("reward_milestones")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("reward_milestones").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "reward_milestone.update" : "reward_milestone.create",
      entityType: "reward_milestone",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListRewardMilestones = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("reward_milestones")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- Priority 17: Reward Boosts ----------
// Kept deliberately simple per spec: action + multiplier + validity
// window. Read by the existing grantRewardAction() (rewards.server.ts) --
// not a second reward calculation engine.

export const adminListRewardBoosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("reward_boosts")
      .select("*")
      .eq("archived", false)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const boostUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  action: z.string().min(1),
  multiplier: z.number().positive(),
  startsAt: z.string(),
  endsAt: z.string(),
  enabled: z.boolean().default(true),
});

export const adminUpsertRewardBoost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => boostUpsertSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    if (new Date(data.endsAt).getTime() <= new Date(data.startsAt).getTime()) {
      throw new Error("endsAt must be after startsAt.");
    }

    // Pre-production audit correction (final business rule): at most one
    // time window may exist for a given action at any point in time --
    // overlapping boosts on the same action are rejected outright, never
    // silently resolved by picking one. Checked against every non-
    // archived boost for this action, enabled or not -- a disabled boost
    // still "reserves" its window rather than leaving room for a
    // confusing double-booking that would only surface once someone
    // re-enables it. Standard half-open interval overlap test:
    // (existing.starts_at < new.ends_at) AND (new.starts_at < existing.ends_at).
    // When editing an existing boost, that row is excluded from the
    // check against itself.
    let overlapQuery = context.supabase
      .from("reward_boosts")
      .select("id, starts_at, ends_at")
      .eq("action", data.action)
      .eq("archived", false)
      .lt("starts_at", data.endsAt)
      .gt("ends_at", data.startsAt);
    if (data.id) overlapQuery = overlapQuery.neq("id", data.id);
    const { data: overlapping, error: overlapError } = await overlapQuery;
    if (overlapError) throw new Error(overlapError.message);
    if (overlapping && overlapping.length > 0) {
      throw new Error(
        "An overlapping reward boost already exists for this action and time period.",
      );
    }

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await context.supabase
        .from("reward_boosts")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      action: data.action,
      multiplier: data.multiplier,
      starts_at: data.startsAt,
      ends_at: data.endsAt,
      enabled: data.enabled,
      created_by: context.userId,
    };

    const { data: saved, error } = data.id
      ? await context.supabase
          .from("reward_boosts")
          .update(payload)
          .eq("id", data.id)
          .select("id")
          .single()
      : await context.supabase.from("reward_boosts").insert(payload).select("id").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "reward_boost.updated" : "reward_boost.created",
      entityType: "reward_boost",
      entityId: (saved as { id: string }).id,
      oldData: previous,
      newData: payload,
    });

    return { id: (saved as { id: string }).id };
  });

export const adminArchiveRewardBoost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("reward_boosts")
      .update({ archived: true, enabled: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "reward_boost.archived",
      entityType: "reward_boost",
      entityId: data.id,
    });
    return { ok: true };
  });
