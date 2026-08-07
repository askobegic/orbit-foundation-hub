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
import { grantRewardAction, promotePendingReferralVerifications } from "@/lib/rewards.server";

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

    const { lifetimePoints, rewardPoints } = await computeBalance(
      context.userId,
      context.supabase,
    );

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
        canRedeem: rewardPoints >= c.points_cost && verifiedReferralsCount >= c.verified_referrals_required,
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
    const { data: item } = await context.supabase
      .from("reward_catalog")
      .select("*")
      .eq("key", data.catalogKey)
      .eq("enabled", true)
      .eq("archived", false)
      .maybeSingle();
    if (!item) throw new Error("Reward not found or unavailable");

    // Same dependency-validation gate as the catalog listing in
    // getRewardsMe -- a capability-gated reward can't be redeemed by
    // bypassing the UI. Fails closed: with a requires_capability set but
    // no appId provided, the caller cannot prove eligibility, so the
    // redemption is rejected rather than allowed by default.
    if (item.requires_capability) {
      if (!data.appId) throw new Error("Reward not found or unavailable");
      const capabilityKeys = await getApplicationCapabilities({ data: { appId: data.appId } });
      if (!capabilityKeys.includes(item.requires_capability)) {
        throw new Error("Reward not found or unavailable");
      }
    }

    const { rewardPoints } = await computeBalance(context.userId, context.supabase);
    if (rewardPoints < item.points_cost) throw new Error("Not enough Reward Points");

    const { count: verifiedReferrals } = await context.supabase
      .from("premium_referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", context.userId)
      .not("verified_at", "is", null);
    if ((verifiedReferrals ?? 0) < item.verified_referrals_required) {
      throw new Error("Not enough Verified Premium Referrals");
    }

    // Redemption is fully tracked and points are deducted immediately.
    // Actual fulfillment (extending Premium, crediting Advertising,
    // creating a Featured slot) is intentionally not automated here -- see
    // PROJECT_KNOWLEDGE.md -> Rewards & Loyalty for why (which application
    // a redeemed Premium duration attaches to isn't yet a decided
    // question, and Advertising/Featured slots don't exist as modules
    // yet). Recorded as pending_fulfillment for admin follow-up rather
    // than silently faked as complete.
    //
    // service_role, not context.supabase: reward_redemptions only grants
    // authenticated SELECT (see the Rewards & Loyalty migration) -- every
    // write goes through server-validated paths like this one, never a
    // direct client-authenticated insert.
    const supabaseAdmin = await adminClient();
    const { data: row, error } = await supabaseAdmin
      .from("reward_redemptions")
      .insert({
        user_id: context.userId,
        catalog_key: item.key,
        points_spent: item.points_cost,
        verified_referrals_at_redemption: verifiedReferrals ?? 0,
        grant_result: { status: "pending_fulfillment", grantType: item.grant_type, grantValue: item.grant_value },
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "reward.redeem",
      entityType: "reward_redemption",
      entityId: row.id,
      newData: row,
    });

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
  action: z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  points: z.number().int().min(0),
  cooldownSeconds: z.number().int().min(0).default(0),
  maxPerUser: z.number().int().min(1).nullable().optional(),
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
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin.from("reward_action_rules").update(payload).eq("id", data.id).select("*").single()
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
  key: z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/),
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
      ? await supabaseAdmin.from("reward_levels").update(payload).eq("id", data.id).select("*").single()
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
  key: z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/),
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
      ? await supabaseAdmin.from("reward_achievements").update(payload).eq("id", data.id).select("*").single()
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
  key: z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
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
  key: z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  pointsCost: z.number().int().min(0),
  verifiedReferralsRequired: z.number().int().min(0).default(0),
  // Validated against reward_fulfillment_types by DB foreign key, not a
  // hardcoded enum here -- see the comment above fulfillmentTypeSchema.
  grantType: z.string().trim().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/),
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
      ? await supabaseAdmin.from("reward_catalog").update(payload).eq("id", data.id).select("*").single()
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
