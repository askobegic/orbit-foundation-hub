// CORE Rewards / Points Purchase -- extends the existing Rewards & Loyalty
// system (Priority 8.3) so a user can optionally buy Points with real
// money. Purchase verification/fulfillment lives in the Stripe/PayPal
// webhooks (src/routes/api/public/webhooks/*.ts), mirroring the existing
// subscription-plan/campaign purchase pattern exactly -- this file is only
// the catalog read and the signed-reference creation step, the same split
// payments.functions.ts already uses for subscription plans. See
// PROJECT_KNOWLEDGE.md -> Points Purchase.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import { signPointsPackageReference } from "@/lib/payment-reference.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ---------- Public ----------

export const getPointsPackages = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ appId: z.string().uuid().nullable() }).parse(raw))
  .handler(async ({ data }) => {
    const supabaseAdmin = await adminClient();
    // Packages are CORE-wide (app_id nullable, see the migration) -- an
    // application-branded package (app_id set) is shown alongside every
    // global one (app_id null), never instead of it.
    let query = supabaseAdmin
      .from("points_packages")
      .select("*")
      .eq("is_active", true)
      .order("display_order", { ascending: true });
    query = data.appId
      ? query.or(`app_id.is.null,app_id.eq.${data.appId}`)
      : query.is("app_id", null);
    const { data: rows } = await query;
    const now = Date.now();
    return (rows ?? []).filter((p) => {
      if (p.valid_from && new Date(p.valid_from).getTime() > now) return false;
      if (p.valid_until && new Date(p.valid_until).getTime() < now) return false;
      return true;
    });
  });

const createReferenceSchema = z.object({
  appId: z.string().uuid(),
  packageId: z.string().uuid(),
});

// The user_id segment comes from the authenticated session, never from
// client input -- same SE-7 closure as createPaymentReference. Re-verifies
// the package is active/in-window/under its per-user purchase limit before
// signing -- a webhook-side re-check happens again at fulfillment (the
// authoritative one), matching the existing "pre-check for UX, webhook is
// authoritative" split.
export const createPointsPurchaseReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => createReferenceSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: rewardConfig } = await context.supabase
      .from("reward_config")
      .select("value")
      .eq("key", "buy_points_enabled")
      .maybeSingle();
    if (rewardConfig?.value !== true) throw new Error("buy_points_disabled");

    const { data: pkg, error } = await context.supabase
      .from("points_packages")
      .select("id, app_id, is_active, valid_from, valid_until, purchase_limit_per_user")
      .eq("id", data.packageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!pkg || !pkg.is_active) throw new Error("package_not_available");
    const now = Date.now();
    if (pkg.valid_from && new Date(pkg.valid_from).getTime() > now)
      throw new Error("package_not_available");
    if (pkg.valid_until && new Date(pkg.valid_until).getTime() < now)
      throw new Error("package_not_available");

    if (pkg.purchase_limit_per_user) {
      const { count } = await context.supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId)
        .eq("points_package_id", data.packageId)
        .eq("status", "success");
      if ((count ?? 0) >= pkg.purchase_limit_per_user) throw new Error("purchase_limit_reached");
    }

    return {
      reference: signPointsPackageReference(context.userId, data.appId, data.packageId),
    };
  });

// ---------- Admin ----------

export const adminListPointsPackages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data } = await supabaseAdmin
      .from("points_packages")
      .select("*, applications(name)")
      .order("display_order", { ascending: true });
    return data ?? [];
  });

const packageUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  appId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1),
  description: z.string().trim().optional(),
  price: z.number().nonnegative(),
  currency: z.string().trim().length(3).default("EUR"),
  pointsAmount: z.number().int().positive(),
  bonusPoints: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  purchaseLimitPerUser: z.number().int().positive().optional(),
  stripePaymentLink: z.string().trim().optional(),
  paypalPaymentLink: z.string().trim().optional(),
});

export const adminUpsertPointsPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => packageUpsertSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("points_packages")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      app_id: data.appId ?? null,
      name: data.name,
      description: data.description ?? null,
      price: data.price,
      currency: data.currency,
      points_amount: data.pointsAmount,
      bonus_points: data.bonusPoints,
      is_active: data.isActive,
      display_order: data.displayOrder,
      valid_from: data.validFrom ?? null,
      valid_until: data.validUntil ?? null,
      purchase_limit_per_user: data.purchaseLimitPerUser ?? null,
      stripe_payment_link: data.stripePaymentLink ?? null,
      paypal_payment_link: data.paypalPaymentLink ?? null,
    };

    const { data: saved, error } = data.id
      ? await supabaseAdmin
          .from("points_packages")
          .update(payload)
          .eq("id", data.id)
          .select("id")
          .single()
      : await supabaseAdmin.from("points_packages").insert(payload).select("id").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "points_package.updated" : "points_package.created",
      entityType: "points_package",
      entityId: (saved as { id: string }).id,
      oldData: previous,
      newData: payload,
    });

    return { id: (saved as { id: string }).id };
  });

export const adminSetPointsPackageActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), isActive: z.boolean() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { error } = await supabaseAdmin
      .from("points_packages")
      .update({ is_active: data.isActive })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "points_package.set_active",
      entityType: "points_package",
      entityId: data.id,
      newData: { isActive: data.isActive },
    });
    return { ok: true };
  });

// Admin visibility into the Points ledger/purchases -- reuses reward_ledger
// as-is (no new ledger table). Includes both the original 'points_purchase'
// grants and any 'refund_reversal' rows tied to one of those same payments
// (resource_id) -- a plain `origin IN (...)` filter alone would also catch
// reversals of unrelated Premium/Advertising refunds, since 'refund_reversal'
// is shared across every purchase type.
export const adminListPointsPurchases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: pointsPayments } = await supabaseAdmin
      .from("payments")
      .select("id")
      .not("points_package_id", "is", null);
    const paymentIds = (pointsPayments ?? []).map((p) => p.id);

    let query = supabaseAdmin
      .from("reward_ledger")
      .select(
        "id, user_id, points, origin, resource_id, metadata, created_at, profiles!reward_ledger_user_id_fkey(username, first_name, last_name)",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    query =
      paymentIds.length > 0
        ? query.or(`action.eq.points_purchased,resource_id.in.(${paymentIds.join(",")})`)
        : query.eq("action", "points_purchased");
    const { data } = await query;
    return data ?? [];
  });
