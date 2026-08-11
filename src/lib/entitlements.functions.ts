// Priority 15 Phase C: admin-facing Grant/Extend/Revoke for the generic
// Entitlements layer (src/lib/entitlements.server.ts), surfaced from the
// existing Manage User modal (/admin/users) alongside Grant/Revoke Premium
// and adminAdjustRewardPoints -- not a new admin surface.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import { extendEntitlement, grantEntitlement, revokeEntitlement } from "@/lib/entitlements.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const adminListUserEntitlements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ userId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: rows, error } = await context.supabase
      .from("entitlements")
      .select("*, applications(name)")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const grantEntitlementSchema = z.object({
  userId: z.string().uuid(),
  benefitType: z.string().trim().min(1),
  appId: z.string().uuid().nullable().optional(),
  durationDays: z.number().int().min(1).nullable().optional(),
  reason: z.string().trim().max(500).min(1),
});

export const adminGrantEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => grantEntitlementSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const result = await grantEntitlement({
      userId: data.userId,
      benefitType: data.benefitType,
      appId: data.appId ?? null,
      durationDays: data.durationDays ?? null,
      reason: data.reason,
      grantedBy: context.userId,
      source: "admin_grant",
    });
    if (!result.ok) throw new Error(result.error ?? "grant_failed");

    await writeAuditLog({
      userId: context.userId,
      action: "entitlement.grant",
      entityType: "entitlement",
      entityId: result.entitlementId ?? null,
      newData: { targetUserId: data.userId, benefitType: data.benefitType, durationDays: data.durationDays ?? null },
      reason: data.reason,
    });
    return { ok: true };
  });

const extendEntitlementSchema = z.object({
  entitlementId: z.string().uuid(),
  additionalDays: z.number().int().min(1),
  reason: z.string().trim().max(500).min(1),
});

export const adminExtendEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => extendEntitlementSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const result = await extendEntitlement(data.entitlementId, data.additionalDays);
    if (!result.ok) throw new Error(result.error ?? "extend_failed");

    await writeAuditLog({
      userId: context.userId,
      action: "entitlement.extend",
      entityType: "entitlement",
      entityId: data.entitlementId,
      newData: { additionalDays: data.additionalDays },
      reason: data.reason,
    });
    return { ok: true };
  });

const revokeEntitlementSchema = z.object({
  entitlementId: z.string().uuid(),
  reason: z.string().trim().max(500).min(1),
});

export const adminRevokeEntitlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => revokeEntitlementSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const supabaseAdmin = await adminClient();
    const { data: previous } = await supabaseAdmin
      .from("entitlements")
      .select("*")
      .eq("id", data.entitlementId)
      .maybeSingle();

    const result = await revokeEntitlement(data.entitlementId);
    if (!result.ok) throw new Error(result.error ?? "revoke_failed");

    await writeAuditLog({
      userId: context.userId,
      action: "entitlement.revoke",
      entityType: "entitlement",
      entityId: data.entitlementId,
      oldData: previous,
      reason: data.reason,
    });
    return { ok: true };
  });

// ---------- User-facing ----------

export const getMyEntitlementsMe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("entitlements")
      .select("*")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .order("ends_at", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });
