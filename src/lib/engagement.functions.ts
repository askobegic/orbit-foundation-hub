// Priority 15 Phase B: admin CRUD + user-facing read for Missions,
// Challenges & Streaks. Same registry+soft-lifecycle shape as
// events.functions.ts/capabilities.functions.ts -- reused deliberately.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ---------- Missions & Challenges (engagement_definitions) ----------

export const adminListEngagementDefinitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ kind: z.enum(["mission", "challenge"]) }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("engagement_definitions")
      .select("*, engagement_conditions(*)")
      .eq("kind", data.kind)
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const engagementDefinitionSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["mission", "challenge"]),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  nameBs: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  nameDe: z.string().trim().min(1).max(200),
  descriptionBs: z.string().trim().max(1000).nullable().optional(),
  descriptionEn: z.string().trim().max(1000).nullable().optional(),
  descriptionDe: z.string().trim().max(1000).nullable().optional(),
  // null = GLOBAL (Phase A scope convention, reused exactly).
  appId: z.string().uuid().nullable(),
  rewardPoints: z.number().int().min(0).default(0),
  rewardLifetimePoints: z.number().int().min(0).default(0),
  // Forward-compatible non-points reward (Phase C territory) -- not set by
  // this admin UI today, but accepted here so the API never needs to
  // change shape when Phase C starts using it.
  rewardGrantType: z.string().trim().max(60).nullable().optional(),
  rewardGrantValue: z.record(z.string(), z.unknown()).optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertEngagementDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => engagementDefinitionSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("engagement_definitions")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      kind: data.kind,
      key: data.key,
      name_bs: data.nameBs,
      name_en: data.nameEn,
      name_de: data.nameDe,
      description_bs: data.descriptionBs ?? null,
      description_en: data.descriptionEn ?? null,
      description_de: data.descriptionDe ?? null,
      app_id: data.appId,
      reward_points: data.rewardPoints,
      reward_lifetime_points: data.rewardLifetimePoints,
      reward_grant_type: data.rewardGrantType ?? null,
      reward_grant_value: (data.rewardGrantValue ?? {}) as Json,
      starts_at: data.startsAt ?? null,
      ends_at: data.endsAt ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("engagement_definitions")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin
          .from("engagement_definitions")
          .upsert(payload, { onConflict: "key" })
          .select("*")
          .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "engagement_definition.update" : "engagement_definition.create",
      entityType: "engagement_definition",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListEngagementConditions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ definitionId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("engagement_conditions")
      .select("*")
      .eq("definition_id", data.definitionId)
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const upsertEngagementConditionSchema = z.object({
  id: z.string().uuid().optional(),
  definitionId: z.string().uuid(),
  eventKey: z.string().trim().min(1),
  target: z.number().int().min(1),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertEngagementCondition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertEngagementConditionSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("engagement_conditions")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      definition_id: data.definitionId,
      event_key: data.eventKey,
      target: data.target,
      display_order: data.displayOrder,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("engagement_conditions")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("engagement_conditions").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "engagement_condition.update" : "engagement_condition.create",
      entityType: "engagement_condition",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminDeleteEngagementCondition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("engagement_conditions")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!previous) return { ok: true };

    const { error } = await supabaseAdmin.from("engagement_conditions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "engagement_condition.delete",
      entityType: "engagement_condition",
      entityId: data.id,
      oldData: previous,
      newData: null,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

// ---------- Streaks ----------

export const adminListStreakDefinitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("streak_definitions")
      .select("*, streak_milestones(*)")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const streakDefinitionSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  nameBs: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200),
  nameDe: z.string().trim().min(1).max(200),
  descriptionBs: z.string().trim().max(1000).nullable().optional(),
  descriptionEn: z.string().trim().max(1000).nullable().optional(),
  descriptionDe: z.string().trim().max(1000).nullable().optional(),
  appId: z.string().uuid().nullable(),
  eventKey: z.string().trim().min(1),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertStreakDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => streakDefinitionSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("streak_definitions")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      key: data.key,
      name_bs: data.nameBs,
      name_en: data.nameEn,
      name_de: data.nameDe,
      description_bs: data.descriptionBs ?? null,
      description_en: data.descriptionEn ?? null,
      description_de: data.descriptionDe ?? null,
      app_id: data.appId,
      event_key: data.eventKey,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("streak_definitions")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin
          .from("streak_definitions")
          .upsert(payload, { onConflict: "key" })
          .select("*")
          .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "streak_definition.update" : "streak_definition.create",
      entityType: "streak_definition",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

const upsertStreakMilestoneSchema = z.object({
  id: z.string().uuid().optional(),
  streakDefinitionId: z.string().uuid(),
  thresholdDays: z.number().int().min(1),
  rewardPoints: z.number().int().min(0).default(0),
  rewardLifetimePoints: z.number().int().min(0).default(0),
  rewardGrantType: z.string().trim().max(60).nullable().optional(),
  rewardGrantValue: z.record(z.string(), z.unknown()).optional(),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertStreakMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertStreakMilestoneSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("streak_milestones")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      streak_definition_id: data.streakDefinitionId,
      threshold_days: data.thresholdDays,
      reward_points: data.rewardPoints,
      reward_lifetime_points: data.rewardLifetimePoints,
      reward_grant_type: data.rewardGrantType ?? null,
      reward_grant_value: (data.rewardGrantValue ?? {}) as Json,
      display_order: data.displayOrder,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("streak_milestones")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin
          .from("streak_milestones")
          .upsert(payload, { onConflict: "streak_definition_id,threshold_days" })
          .select("*")
          .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "streak_milestone.update" : "streak_milestone.create",
      entityType: "streak_milestone",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminDeleteStreakMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("streak_milestones")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!previous) return { ok: true };

    const { error } = await supabaseAdmin.from("streak_milestones").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "streak_milestone.delete",
      entityType: "streak_milestone",
      entityId: data.id,
      oldData: previous,
      newData: null,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

// ---------- Config (engagement_config) ----------

export const adminListEngagementConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase.from("engagement_config").select("*").order("key");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const setEngagementConfigSchema = z.object({
  key: z.string().trim().min(1),
  value: z.unknown(),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetEngagementConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => setEngagementConfigSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("engagement_config")
      .select("*")
      .eq("key", data.key)
      .maybeSingle();

    const { data: row, error } = await supabaseAdmin
      .from("engagement_config")
      .upsert({ key: data.key, value: data.value as Json, updated_at: new Date().toISOString() }, { onConflict: "key" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "engagement_config.set",
      entityType: "engagement_config",
      entityId: row.key,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

// ---------- User-facing: getMyEngagement ----------

const getMyEngagementSchema = z.object({ appId: z.string().uuid().nullable().optional() });

export const getMyEngagement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => getMyEngagementSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const appId = data.appId ?? null;
    const nowMs = Date.now();

    const [{ data: definitions }, { data: completions }, { data: streakDefs }, { data: userStreaks }] =
      await Promise.all([
        context.supabase
          .from("engagement_definitions")
          .select("*, engagement_conditions(*)")
          .eq("enabled", true)
          .eq("archived", false)
          .order("display_order", { ascending: true }),
        context.supabase
          .from("user_engagement_completions")
          .select("definition_id, completed_at")
          .eq("user_id", context.userId),
        context.supabase
          .from("streak_definitions")
          .select("*, streak_milestones(*)")
          .eq("enabled", true)
          .eq("archived", false)
          .order("display_order", { ascending: true }),
        context.supabase
          .from("user_streaks")
          .select("*")
          .eq("user_id", context.userId),
      ]);

    const completedMap = new Map((completions ?? []).map((c) => [c.definition_id, c.completed_at]));
    const visibleDefinitions = (definitions ?? []).filter((d) => {
      if (d.app_id !== null && d.app_id !== appId) return false;
      if (d.starts_at && new Date(d.starts_at).getTime() > nowMs) return false;
      if (d.ends_at && new Date(d.ends_at).getTime() < nowMs) return false;
      return true;
    });

    const engagement = await Promise.all(
      visibleDefinitions.map(async (d) => {
        const completedAt = completedMap.get(d.id) ?? null;
        const conditions = (d.engagement_conditions ?? []) as { event_key: string; target: number }[];
        const progress = await Promise.all(
          conditions.map(async (c) => {
            if (completedAt) return { eventKey: c.event_key, target: c.target, count: c.target };
            let query = context.supabase
              .from("reward_ledger")
              .select("id", { count: "exact", head: true })
              .eq("user_id", context.userId)
              .eq("action", c.event_key)
              .gt("points", 0);
            if (d.starts_at) query = query.gte("created_at", d.starts_at);
            if (d.ends_at) query = query.lte("created_at", d.ends_at);
            if (d.app_id !== null) query = query.eq("source_app_id", d.app_id);
            const { count } = await query;
            return { eventKey: c.event_key, target: c.target, count: Math.min(count ?? 0, c.target) };
          }),
        );
        return {
          id: d.id,
          kind: d.kind,
          key: d.key,
          nameBs: d.name_bs,
          nameEn: d.name_en,
          nameDe: d.name_de,
          descriptionBs: d.description_bs,
          descriptionEn: d.description_en,
          descriptionDe: d.description_de,
          rewardPoints: d.reward_points,
          endsAt: d.ends_at,
          completed: !!completedAt,
          completedAt,
          conditions: progress,
        };
      }),
    );

    const userStreakByDefId = new Map((userStreaks ?? []).map((s) => [s.streak_definition_id, s]));
    const streaks = (streakDefs ?? [])
      .filter((s) => s.app_id === null || s.app_id === appId)
      .map((s) => {
        const state = userStreakByDefId.get(s.id);
        const milestones = ((s.streak_milestones ?? []) as { threshold_days: number }[]).sort(
          (a, b) => a.threshold_days - b.threshold_days,
        );
        return {
          id: s.id,
          key: s.key,
          nameBs: s.name_bs,
          nameEn: s.name_en,
          nameDe: s.name_de,
          currentStreak: state?.current_streak ?? 0,
          longestStreak: state?.longest_streak ?? 0,
          lastQualifyingDate: state?.last_qualifying_date ?? null,
          milestones: milestones.map((m) => ({ thresholdDays: m.threshold_days })),
        };
      });

    return {
      missions: engagement.filter((e) => e.kind === "mission"),
      challenges: engagement.filter((e) => e.kind === "challenge"),
      streaks,
    };
  });
