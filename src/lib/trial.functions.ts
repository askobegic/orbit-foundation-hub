// Priority 8.5: Promotional Trial -- public server-function surface.
//
// Replaces the old automatic 7-day trial entirely. There is no
// auto-activation anywhere in this codebase anymore: a newly registered
// user always starts Standard, and the only way to become Trial is an
// explicit grant through one of trial_sources' business rules (today:
// adminGrantPromotionalTrial; see trial.server.ts for the shared core
// logic future sources will call). See PROJECT_KNOWLEDGE.md -> Promotional
// Trial.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import { grantPromotionalTrial } from "@/lib/trial.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// Public: the caller's own current (or most recent) Promotional Trial, for
// TrialBanner -- read-only, never activates anything.
export const getMyActiveTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("promotional_trials")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  });

// Public (no auth needed -- purely display data for the admin grant form
// and any future self-serve entry point): the current quick-select presets
// and the maximum allowed duration. Configuration-First: never hardcoded.
export const getTrialPolicy = createServerFn({ method: "POST" }).handler(async () => {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data } = await supabase.from("trial_policy").select("*");
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  const presetDays = byKey.get("preset_days");
  const maxDurationDays = byKey.get("max_duration_days");
  return {
    presetDays: Array.isArray(presetDays) ? (presetDays as number[]) : [1, 3, 7, 14],
    maxDurationDays: typeof maxDurationDays === "number" ? maxDurationDays : 90,
  };
});

const grantSchema = z.object({
  userId: z.string().uuid(),
  days: z.number().int().min(1),
  reason: z.string().trim().max(500).optional(),
});

const GRANT_ERROR_MESSAGES: Record<string, string> = {
  invalid_duration: "Duration is outside the allowed range for this policy.",
  already_has_active_trial: "This user already has an active Promotional Trial.",
  source_not_configured: "The admin_grant trial source is disabled.",
  insert_failed: "Could not grant this trial.",
};

export const adminGrantPromotionalTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => grantSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const result = await grantPromotionalTrial({
      userId: data.userId,
      days: data.days,
      source: "admin_grant",
      grantedBy: context.userId,
      reason: data.reason ?? null,
    });
    if (!result.ok) {
      throw new Error(GRANT_ERROR_MESSAGES[result.reason] ?? "Could not grant this trial.");
    }

    await writeAuditLog({
      userId: context.userId,
      action: "promotional_trial.grant",
      entityType: "promotional_trial",
      entityId: result.trialId,
      newData: { targetUserId: data.userId, days: data.days, expiresAt: result.expiresAt },
      reason: data.reason ?? null,
    });
    return result;
  });

const endTrialSchema = z.object({
  trialId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

// Shared by adminEndTrial/adminRevokeTrial below -- mechanically identical
// (both set a terminal status + ended_at), kept as two distinct functions
// and two distinct statuses/audit actions because they carry different
// administrative meaning: "end" is a legitimate trial being cut short,
// "revoke" is a correction (it shouldn't have been granted, or should stop
// immediately for cause).
async function setTrialStatus(
  trialId: string,
  status: "ended" | "revoked",
  adminUserId: string,
  reason?: string | null,
) {
  const supabaseAdmin = await adminClient();

  const { data: previous } = await supabaseAdmin
    .from("promotional_trials")
    .select("*")
    .eq("id", trialId)
    .maybeSingle();
  if (!previous) throw new Error("Trial not found");
  if (previous.status !== "active") throw new Error("This trial is not currently active");

  const { data: row, error } = await supabaseAdmin
    .from("promotional_trials")
    .update({ status, ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", trialId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    userId: adminUserId,
    action: status === "ended" ? "promotional_trial.end" : "promotional_trial.revoke",
    entityType: "promotional_trial",
    entityId: trialId,
    oldData: previous,
    newData: row,
    reason: reason ?? null,
  });
  return row;
}

export const adminEndTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => endTrialSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return setTrialStatus(data.trialId, "ended", context.userId, data.reason ?? null);
  });

export const adminRevokeTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => endTrialSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    return setTrialStatus(data.trialId, "revoked", context.userId, data.reason ?? null);
  });

const historySchema = z.object({ userId: z.string().uuid().optional() });

export const adminListTrialHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => historySchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    let query = supabaseAdmin
      .from("promotional_trials")
      .select(
        "*, profiles!promotional_trials_user_id_fkey(username, first_name, last_name), granted_by_profile:profiles!promotional_trials_granted_by_fkey(username, first_name, last_name)",
      );
    if (data.userId) query = query.eq("user_id", data.userId);
    const { data: rows, error } = await query.order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminListTrialSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("trial_sources")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const policySchema = z.object({
  presetDays: z.array(z.number().int().min(1)).optional(),
  maxDurationDays: z.number().int().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetTrialPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => policySchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const updates: { key: string; value: Json }[] = [];
    if (data.presetDays) updates.push({ key: "preset_days", value: data.presetDays as Json });
    if (data.maxDurationDays !== undefined) {
      updates.push({ key: "max_duration_days", value: data.maxDurationDays as Json });
    }

    for (const u of updates) {
      const { data: previous } = await supabaseAdmin
        .from("trial_policy")
        .select("value")
        .eq("key", u.key)
        .maybeSingle();
      const { error } = await supabaseAdmin
        .from("trial_policy")
        .upsert({ key: u.key, value: u.value, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      await writeAuditLog({
        userId: context.userId,
        action: "trial_policy.set",
        entityType: "trial_policy",
        entityId: u.key,
        oldData: previous?.value ?? null,
        newData: u.value,
        reason: data.reason ?? null,
      });
    }
    return { ok: true };
  });
