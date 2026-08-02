// Priority 8.2: Dashboard Widget Modularity.
//
// Same registry + per-application-override shape as
// src/lib/capabilities.functions.ts (Priority 8.1) -- reused deliberately,
// not reinvented, since it's structurally the same problem. See
// PROJECT_KNOWLEDGE.md -> Dashboard Widget Modularity.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import { getApplicationCapabilities } from "@/lib/capabilities.functions";

export type DashboardWidgetDefinition = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  requiresCapability: string | null;
  displayOrder: number;
  enabled: boolean;
  archived: boolean;
};

function toDefinition(row: {
  id: string;
  key: string;
  label: string;
  description: string | null;
  requires_capability: string | null;
  display_order: number;
  enabled: boolean;
  archived: boolean;
}): DashboardWidgetDefinition {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    requiresCapability: row.requires_capability,
    displayOrder: row.display_order,
    enabled: row.enabled,
    archived: row.archived,
  };
}

// Public: the widget keys currently visible for one application, in
// display order. A widget is visible only if: its definition is
// enabled+not archived, its per-application override (if any) says
// enabled, AND (when requiresCapability is set) that capability is
// currently enabled for this application -- disabling the capability
// hides the widget with no separate check needed (dependency validation,
// adjustment 2).
export const getDashboardWidgets = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ appId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }): Promise<string[]> => {
    const { supabase } = await import("@/integrations/supabase/client");
    const [{ data: definitions, error: defError }, { data: overrides, error: overrideError }] =
      await Promise.all([
        supabase
          .from("dashboard_widgets")
          .select("*")
          .eq("archived", false)
          .eq("enabled", true)
          .order("display_order", { ascending: true }),
        supabase
          .from("dashboard_widget_settings")
          .select("widget_key, enabled")
          .eq("app_id", data.appId),
      ]);
    if (defError || overrideError) {
      console.error("getDashboardWidgets failed", defError ?? overrideError);
      return [];
    }
    const overrideByKey = new Map((overrides ?? []).map((o) => [o.widget_key, o.enabled]));

    const capabilityKeys = new Set(
      await getApplicationCapabilities({ data: { appId: data.appId } }),
    );

    return (definitions ?? [])
      .filter((w) => overrideByKey.get(w.key) ?? true)
      .filter((w) => !w.requires_capability || capabilityKeys.has(w.requires_capability))
      .map((w) => w.key);
  });

export const adminListDashboardWidgets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardWidgetDefinition[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("dashboard_widgets")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toDefinition);
  });

const upsertWidgetSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  requiresCapability: z.string().trim().nullable().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertDashboardWidget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertWidgetSchema.parse(raw))
  .handler(async ({ data, context }): Promise<DashboardWidgetDefinition> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let previous: DashboardWidgetDefinition | null = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("dashboard_widgets")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (existing) previous = toDefinition(existing);
    }

    const payload = {
      key: data.key,
      label: data.label,
      description: data.description ?? null,
      requires_capability: data.requiresCapability ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };

    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("dashboard_widgets")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("dashboard_widgets").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "dashboard_widget.update" : "dashboard_widget.create",
      entityType: "dashboard_widget",
      entityId: row.id,
      oldData: previous,
      newData: toDefinition(row),
      reason: data.reason ?? null,
    });

    return toDefinition(row);
  });

const setAppWidgetSchema = z.object({
  appId: z.string().uuid(),
  widgetKey: z.string(),
  enabled: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetDashboardWidgetAppSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => setAppWidgetSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: previous } = await supabaseAdmin
      .from("dashboard_widget_settings")
      .select("enabled")
      .eq("app_id", data.appId)
      .eq("widget_key", data.widgetKey)
      .maybeSingle();

    const { data: row, error } = await supabaseAdmin
      .from("dashboard_widget_settings")
      .upsert(
        { app_id: data.appId, widget_key: data.widgetKey, enabled: data.enabled },
        { onConflict: "widget_key,app_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "dashboard_widget_setting.set",
      entityType: "dashboard_widget_setting",
      entityId: row.id,
      oldData: { enabled: previous?.enabled ?? true },
      newData: { enabled: row.enabled },
      reason: data.reason ?? null,
    });

    return { ok: true };
  });

export const adminListDashboardWidgetSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ appId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const [{ data: definitions, error: defError }, { data: settings, error: settingsError }] =
      await Promise.all([
        context.supabase
          .from("dashboard_widgets")
          .select("*")
          .eq("archived", false)
          .order("display_order", { ascending: true }),
        context.supabase
          .from("dashboard_widget_settings")
          .select("widget_key, enabled")
          .eq("app_id", data.appId),
      ]);
    if (defError) throw new Error(defError.message);
    if (settingsError) throw new Error(settingsError.message);

    const enabledByKey = new Map((settings ?? []).map((s) => [s.widget_key, s.enabled]));
    return (definitions ?? []).map((d) => ({
      ...toDefinition(d),
      appEnabled: enabledByKey.get(d.key) ?? true,
    }));
  });
