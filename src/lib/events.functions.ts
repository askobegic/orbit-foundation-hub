// Priority 12 Phase 2: Universal Event & Rewards Engine -- admin CRUD for
// the Event Registry, Application Mapping, and Reward Rule Engine
// (event_definitions / application_events / event_rules /
// event_rule_conditions). Same registry+mapping shape as capabilities.functions.ts
// (capability_definitions/application_capabilities) and
// dashboard-widgets.functions.ts -- reused deliberately, not reinvented.
//
// This file is admin CRUD only. The event-ingestion pipeline
// (recordEvent(), condition evaluation, anti-abuse) is Phase 3 and lives in
// events.server.ts / a public events.functions.ts entry added at that time.
// See PROJECT_KNOWLEDGE.md -> Rewards & Loyalty / Universal Event Engine.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ---------- Event Registry (event_definitions) ----------

export const adminListEventDefinitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("event_definitions")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const eventDefinitionSchema = z.object({
  id: z.string().uuid().optional(),
  eventKey: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  icon: z.string().trim().max(60).nullable().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

// Registers a new event key, or edits an existing definition's metadata.
// event_key itself is immutable in practice (never repurposed for a
// different meaning -- see the versioning-strategy comment in the Phase 1
// migration) even though nothing here technically blocks changing it; the
// UI never offers to edit an existing row's key, only create new ones.
// `version` is auto-incremented on every update, purely for admin
// visibility -- writeAuditLog's old/new diff is the real change history.
export const adminUpsertEventDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => eventDefinitionSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: { version: number } | null = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("event_definitions")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      event_key: data.eventKey,
      display_name: data.displayName,
      description: data.description ?? null,
      category: data.category ?? null,
      icon: data.icon ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
      ...(data.id ? { version: (previous?.version ?? 1) + 1 } : {}),
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("event_definitions")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("event_definitions").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "event_definition.update" : "event_definition.create",
      entityType: "event_definition",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

// ---------- Application Mapping (application_events) ----------

export const adminListApplicationEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ appId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const [{ data: definitions, error: defError }, { data: mappings, error: mapError }] =
      await Promise.all([
        context.supabase
          .from("event_definitions")
          .select("*")
          .eq("archived", false)
          .order("display_order", { ascending: true }),
        context.supabase
          .from("application_events")
          .select("event_key, enabled")
          .eq("app_id", data.appId),
      ]);
    if (defError) throw new Error(defError.message);
    if (mapError) throw new Error(mapError.message);

    const enabledByKey = new Map((mappings ?? []).map((m) => [m.event_key, m.enabled]));
    return (definitions ?? []).map((d) => ({
      ...d,
      appEnabled: enabledByKey.get(d.event_key) ?? false,
    }));
  });

const setApplicationEventSchema = z.object({
  appId: z.string().uuid(),
  eventKey: z.string(),
  enabled: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

// Fails closed, same as application_capabilities: no row for (app, event)
// means that event is not live for that application. Toggling this on its
// own does not grant points -- an event_rules row (below) must also exist
// and be enabled for the event to actually reward anything once Phase 3's
// recordEvent() pipeline is wired in.
export const adminSetApplicationEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => setApplicationEventSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("application_events")
      .select("enabled")
      .eq("app_id", data.appId)
      .eq("event_key", data.eventKey)
      .maybeSingle();

    const { data: row, error } = await supabaseAdmin
      .from("application_events")
      .upsert(
        { app_id: data.appId, event_key: data.eventKey, enabled: data.enabled },
        { onConflict: "app_id,event_key" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "application_event.set",
      entityType: "application_event",
      entityId: row.id,
      oldData: { enabled: previous?.enabled ?? false },
      newData: { enabled: row.enabled },
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

// ---------- Reward Rule Engine (event_rules + event_rule_conditions) ----------

export const adminListEventRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ appId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("event_rules")
      .select("*")
      .eq("app_id", data.appId)
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const eventRuleSchema = z.object({
  id: z.string().uuid().optional(),
  appId: z.string().uuid(),
  eventKey: z.string().trim().min(1),
  points: z.number().int().min(0).default(0),
  // Independent from `points` (Priority 12 decision 1). Left equal to
  // `points` by the admin UI unless deliberately diverged.
  lifetimePoints: z.number().int().min(0).default(0),
  cooldownSeconds: z.number().int().min(0).default(0),
  maxExecutions: z.number().int().min(1).nullable().optional(),
  dailyLimit: z.number().int().min(1).nullable().optional(),
  weeklyLimit: z.number().int().min(1).nullable().optional(),
  monthlyLimit: z.number().int().min(1).nullable().optional(),
  priority: z.number().int().default(0),
  repeatable: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

// One rule per (app, event) -- upsert on that pair, matching event_rules'
// UNIQUE(app_id, event_key) constraint from the Phase 1 migration.
export const adminUpsertEventRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => eventRuleSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("event_rules")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      app_id: data.appId,
      event_key: data.eventKey,
      points: data.points,
      lifetime_points: data.lifetimePoints,
      cooldown_seconds: data.cooldownSeconds,
      max_executions: data.maxExecutions ?? null,
      daily_limit: data.dailyLimit ?? null,
      weekly_limit: data.weeklyLimit ?? null,
      monthly_limit: data.monthlyLimit ?? null,
      priority: data.priority,
      repeatable: data.repeatable,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("event_rules")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin
          .from("event_rules")
          .upsert(payload, { onConflict: "app_id,event_key" })
          .select("*")
          .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "event_rule.update" : "event_rule.create",
      entityType: "event_rule",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListEventRuleConditions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ ruleId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("event_rule_conditions")
      .select("*")
      .eq("rule_id", data.ruleId)
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const upsertConditionSchema = z.object({
  id: z.string().uuid().optional(),
  ruleId: z.string().uuid(),
  // A small, code-implemented, growing set of predicates (evaluated in
  // events.server.ts starting Phase 3) -- see the Phase 1 migration
  // comment above event_rule_conditions. Which conditions apply to a
  // given rule, and their thresholds, are admin-configurable without
  // code; adding a genuinely new predicate type requires a code change.
  conditionType: z.string().trim().min(1).max(60),
  params: z.record(z.string(), z.unknown()).default({}),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

// Conditions have no soft-lifecycle columns (see the Phase 1 migration) --
// they're parameters attached to a rule, not an independently-referenced
// registry, so create/update-in-place/delete is the correct shape here.
export const adminUpsertEventRuleCondition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertConditionSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("event_rule_conditions")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      rule_id: data.ruleId,
      condition_type: data.conditionType,
      params: data.params as Json,
      display_order: data.displayOrder,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("event_rule_conditions")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("event_rule_conditions").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "event_rule_condition.update" : "event_rule_condition.create",
      entityType: "event_rule_condition",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminDeleteEventRuleCondition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("event_rule_conditions")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!previous) return { ok: true };

    const { error } = await supabaseAdmin.from("event_rule_conditions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "event_rule_condition.delete",
      entityType: "event_rule_condition",
      entityId: data.id,
      oldData: previous,
      newData: null,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });
