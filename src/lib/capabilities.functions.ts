// Priority 8.1: Capabilities system.
//
// The single mechanism that keeps CORE from ever branching on which
// application is calling it by name. Every configurable module (Dashboard
// widgets, Rewards, Advertising, and Messaging/Premium going forward) gates
// itself on a capability key here instead of an "if BosniaFans" check
// anywhere in CORE. See PROJECT_KNOWLEDGE.md -> Capabilities.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";

export type CapabilityDefinition = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  displayOrder: number;
  enabled: boolean;
  archived: boolean;
};

function toCapabilityDefinition(row: {
  id: string;
  key: string;
  label: string;
  description: string | null;
  display_order: number;
  enabled: boolean;
  archived: boolean;
}): CapabilityDefinition {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    displayOrder: row.display_order,
    enabled: row.enabled,
    archived: row.archived,
  };
}

// Public: the enabled capability keys for one application. Not gated to
// admins -- the calling application itself, and any cross-application UI,
// both need to read this without a privileged session. Archived/disabled
// definitions never appear here even if a row in application_capabilities
// still marks them enabled=true for some app (a definition being archived
// always wins).
export const getApplicationCapabilities = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ appId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }): Promise<string[]> => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: rows, error } = await supabase
      .from("application_capabilities")
      .select("capability_key, enabled, capability_definitions!inner(enabled, archived)")
      .eq("app_id", data.appId)
      .eq("enabled", true)
      .eq("capability_definitions.enabled", true)
      .eq("capability_definitions.archived", false);
    if (error) {
      console.error("getApplicationCapabilities failed", error);
      return [];
    }
    return (rows ?? []).map((r) => r.capability_key);
  });

export const adminListCapabilityDefinitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CapabilityDefinition[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("capability_definitions")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toCapabilityDefinition);
  });

const upsertDefinitionSchema = z.object({
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

// Registers a brand new capability, or edits an existing one -- this is the
// entire mechanism by which a future capability (e.g. a module none of
// today's five applications need yet) is added without a deployment.
export const adminUpsertCapabilityDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertDefinitionSchema.parse(raw))
  .handler(async ({ data, context }): Promise<CapabilityDefinition> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let previous: CapabilityDefinition | null = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("capability_definitions")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (existing) previous = toCapabilityDefinition(existing);
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
          .from("capability_definitions")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin
          .from("capability_definitions")
          .insert(payload)
          .select("*")
          .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "capability_definition.update" : "capability_definition.create",
      entityType: "capability_definition",
      entityId: row.id,
      oldData: previous,
      newData: toCapabilityDefinition(row),
      reason: data.reason ?? null,
    });

    return toCapabilityDefinition(row);
  });

const setAppCapabilitySchema = z.object({
  appId: z.string().uuid(),
  capabilityKey: z.string(),
  enabled: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

// Dependency validation (adjustment 2) belongs to the *consumer* of this
// flag, not to this table -- disabling a capability here is the single
// source of truth every module's own gating (dashboard widget visibility,
// nav, API responses, background jobs) reads from. This function only
// flips the flag and audits it; it does not itself reach into other
// modules to hide their UI -- see PROJECT_KNOWLEDGE.md -> Capabilities ->
// Dependency Validation for why that's each module's own responsibility,
// not this one's.
export const adminSetApplicationCapability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => setAppCapabilitySchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: previous } = await supabaseAdmin
      .from("application_capabilities")
      .select("enabled")
      .eq("app_id", data.appId)
      .eq("capability_key", data.capabilityKey)
      .maybeSingle();

    const { data: row, error } = await supabaseAdmin
      .from("application_capabilities")
      .upsert(
        { app_id: data.appId, capability_key: data.capabilityKey, enabled: data.enabled },
        { onConflict: "app_id,capability_key" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "application_capability.set",
      entityType: "application_capability",
      entityId: row.id,
      oldData: { enabled: previous?.enabled ?? false },
      newData: { enabled: row.enabled },
      reason: data.reason ?? null,
    });

    return { ok: true };
  });

export const adminListApplicationCapabilities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ appId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const [{ data: definitions, error: defError }, { data: settings, error: settingsError }] =
      await Promise.all([
        context.supabase
          .from("capability_definitions")
          .select("*")
          .eq("archived", false)
          .order("display_order", { ascending: true }),
        context.supabase
          .from("application_capabilities")
          .select("capability_key, enabled")
          .eq("app_id", data.appId),
      ]);
    if (defError) throw new Error(defError.message);
    if (settingsError) throw new Error(settingsError.message);

    const enabledByKey = new Map((settings ?? []).map((s) => [s.capability_key, s.enabled]));
    return (definitions ?? []).map((d) => ({
      ...toCapabilityDefinition(d),
      appEnabled: enabledByKey.get(d.key) ?? false,
    }));
  });
