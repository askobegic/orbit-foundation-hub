// Priority 17: Public Coupons.
//
// A Public Coupon is discoverable by anyone (no CORE account required --
// resolvePublicCoupon is anon-callable), but redemption requires an
// authenticated CORE account, and the actual checkout still goes through
// the referenced product's own existing, real, static Stripe/PayPal
// Payment Link (see payment-reference.server.ts's header comment) --
// there is no dynamic Checkout Session creation anywhere in this
// codebase, and this module does not introduce one.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import { resolveDisplayPricing, resolveProduct } from "@/lib/offers.functions";
import { signCouponReference } from "@/lib/payment-reference.server";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export interface ResolvedCoupon {
  id: string;
  code: string;
  displayLabel: string | null;
  titleBs: string;
  titleEn: string;
  titleDe: string;
  descriptionBs: string | null;
  descriptionEn: string | null;
  descriptionDe: string | null;
  productType: string;
  productId: string;
  productName: string;
  discountType: string;
  discountPercent: number | null;
  fixedPrice: number | null;
  // finalPrice is always the referenced product's real, actually-charged
  // price; wasPrice is a reverse-derived, display-only strikethrough
  // (percent discounts only) -- see resolveDisplayPricing's comment.
  finalPrice: number;
  wasPrice: number | null;
  currency: string;
  startsAt: string;
  endsAt: string;
  valid: boolean;
  invalidReason: string | null;
}

// ---------- Public: resolve a coupon by code (anon-callable) ----------
// Backs /offer/:code -- a non-member must be able to see the coupon and
// its discount before ever creating an account (spec section 6/9).

export const resolvePublicCoupon = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ code: z.string().min(1) }).parse(raw))
  .handler(async ({ data }): Promise<ResolvedCoupon | null> => {
    // Abuse protection against unthrottled coupon-code enumeration/scraping
    // (security-sweep Finding 4) -- generous enough that normal sharing
    // (multiple users behind the same office/NAT IP opening the same
    // /offer/:code link) is unaffected; codes themselves stay intentionally
    // shareable, only high-volume guessing is throttled. Reuses the
    // existing in-memory limiter (Priority 11 security audit), keyed by IP
    // since this endpoint is anon-callable and has no user id to key on.
    const request = getRequest();
    enforceRateLimit(`resolve-coupon:${request ? clientIp(request) : "unknown"}`, 20, 60 * 1000);

    const supabaseAdmin = await adminClient();
    const code = normalizeCode(data.code);
    const { data: row } = await supabaseAdmin
      .from("public_coupons")
      .select("*")
      .eq("code", code)
      .eq("enabled", true)
      .eq("archived", false)
      .eq("is_public", true)
      .maybeSingle();
    if (!row) return null;

    const coupon = row as {
      id: string;
      code: string;
      display_label: string | null;
      title_bs: string;
      title_en: string;
      title_de: string;
      description_bs: string | null;
      description_en: string | null;
      description_de: string | null;
      product_type: string;
      product_id: string;
      discount_type: string;
      discount_percent: number | null;
      fixed_price: number | null;
      starts_at: string;
      ends_at: string;
      max_total_uses: number | null;
    };

    const product = await resolveProduct(supabaseAdmin, coupon.product_type, coupon.product_id);
    if (!product) return null;

    const now = Date.now();
    let valid = true;
    let invalidReason: string | null = null;
    if (now < new Date(coupon.starts_at).getTime()) {
      valid = false;
      invalidReason = "not_started";
    } else if (now > new Date(coupon.ends_at).getTime()) {
      valid = false;
      invalidReason = "expired";
    } else if (coupon.max_total_uses != null) {
      const { count } = await supabaseAdmin
        .from("coupon_redemptions")
        .select("id", { count: "exact", head: true })
        .eq("coupon_id", coupon.id);
      if ((count ?? 0) >= coupon.max_total_uses) {
        valid = false;
        invalidReason = "max_uses_reached";
      }
    }

    return {
      id: coupon.id,
      code: coupon.code,
      displayLabel: coupon.display_label,
      titleBs: coupon.title_bs,
      titleEn: coupon.title_en,
      titleDe: coupon.title_de,
      descriptionBs: coupon.description_bs,
      descriptionEn: coupon.description_en,
      descriptionDe: coupon.description_de,
      productType: coupon.product_type,
      productId: coupon.product_id,
      productName: product.name,
      discountType: coupon.discount_type,
      discountPercent: coupon.discount_percent,
      fixedPrice: coupon.fixed_price,
      ...resolveDisplayPricing(product.basePrice, coupon.discount_type, coupon.discount_percent),
      currency: product.currency,
      startsAt: coupon.starts_at,
      endsAt: coupon.ends_at,
      valid,
      invalidReason,
    };
  });

// ---------- Authenticated: begin checkout for a coupon ----------
// Pre-checks eligibility (server-side, never trusted from the client) and
// returns a signed reference plus the real product's payment links --
// the same shape pricing.tsx's handlePay already consumes.

export const createCouponCheckoutReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ code: z.string().min(1) }).parse(raw))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await adminClient();
    const code = normalizeCode(data.code);
    const { data: row } = await supabaseAdmin
      .from("public_coupons")
      .select("*")
      .eq("code", code)
      .eq("enabled", true)
      .eq("archived", false)
      .maybeSingle();
    if (!row) throw new Error("coupon_not_found");

    const coupon = row as {
      id: string;
      product_type: string;
      product_id: string;
      starts_at: string;
      ends_at: string;
      max_total_uses: number | null;
      max_uses_per_user: number;
    };

    // Scope limitation, deliberate and documented (not silently assumed):
    // coupon checkout reuses the signed-reference + static-Payment-Link +
    // webhook flow, which needs a concrete app_id/plan_id to sign against
    // -- only subscription_plan-backed coupons can check out today.
    // ad_placement_price-backed coupons can still be created/displayed
    // (resolvePublicCoupon works for both), just not redeemed to
    // checkout yet -- a future extension, not a silent gap.
    if (coupon.product_type !== "subscription_plan") {
      throw new Error("checkout_unsupported_for_product_type");
    }

    const now = Date.now();
    if (now < new Date(coupon.starts_at).getTime() || now > new Date(coupon.ends_at).getTime()) {
      throw new Error("coupon_not_currently_valid");
    }
    if (coupon.max_total_uses != null) {
      const { count } = await supabaseAdmin
        .from("coupon_redemptions")
        .select("id", { count: "exact", head: true })
        .eq("coupon_id", coupon.id);
      if ((count ?? 0) >= coupon.max_total_uses) throw new Error("max_uses_reached");
    }
    const { count: userUses } = await supabaseAdmin
      .from("coupon_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", coupon.id)
      .eq("user_id", context.userId);
    if ((userUses ?? 0) >= coupon.max_uses_per_user) throw new Error("max_uses_per_user_reached");

    const { data: plan } = await supabaseAdmin
      .from("subscription_plans")
      .select("app_id, stripe_payment_link, paypal_payment_link, is_active")
      .eq("id", coupon.product_id)
      .maybeSingle();
    if (!plan || !(plan as { is_active: boolean }).is_active) throw new Error("plan_unavailable");
    const planRow = plan as {
      app_id: string;
      stripe_payment_link: string | null;
      paypal_payment_link: string | null;
    };

    return {
      reference: signCouponReference(context.userId, planRow.app_id, coupon.product_id, coupon.id),
      stripePaymentLink: planRow.stripe_payment_link,
      paypalPaymentLink: planRow.paypal_payment_link,
    };
  });

// ---------- Admin ----------

export const adminListPublicCoupons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data } = await supabaseAdmin
      .from("public_coupons")
      .select("*")
      .eq("archived", false)
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const adminGetCouponStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ couponId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { count } = await supabaseAdmin
      .from("coupon_redemptions")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", data.couponId);
    return { totalRedemptions: count ?? 0 };
  });

const couponUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1),
  displayLabel: z.string().optional(),
  titleBs: z.string().min(1),
  titleEn: z.string().min(1),
  titleDe: z.string().min(1),
  descriptionBs: z.string().optional(),
  descriptionEn: z.string().optional(),
  descriptionDe: z.string().optional(),
  productType: z.enum(["subscription_plan", "ad_placement_price"]),
  productId: z.string().uuid(),
  discountType: z.enum(["percent", "fixed_price"]),
  discountPercent: z.number().positive().max(100).optional(),
  fixedPrice: z.number().nonnegative().optional(),
  minPurchase: z.number().nonnegative().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  maxTotalUses: z.number().int().positive().optional(),
  maxUsesPerUser: z.number().int().positive().default(1),
  isPublic: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

export const adminUpsertPublicCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => couponUpsertSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const product = await resolveProduct(supabaseAdmin, data.productType, data.productId);
    if (!product) throw new Error("Referenced product not found or inactive.");

    const code = normalizeCode(data.code);

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("public_coupons")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      code,
      display_label: data.displayLabel ?? null,
      title_bs: data.titleBs,
      title_en: data.titleEn,
      title_de: data.titleDe,
      description_bs: data.descriptionBs ?? null,
      description_en: data.descriptionEn ?? null,
      description_de: data.descriptionDe ?? null,
      product_type: data.productType,
      product_id: data.productId,
      discount_type: data.discountType,
      discount_percent: data.discountType === "percent" ? (data.discountPercent ?? null) : null,
      fixed_price: data.discountType === "fixed_price" ? (data.fixedPrice ?? null) : null,
      min_purchase: data.minPurchase ?? null,
      starts_at: data.startsAt,
      ends_at: data.endsAt,
      max_total_uses: data.maxTotalUses ?? null,
      max_uses_per_user: data.maxUsesPerUser,
      is_public: data.isPublic,
      enabled: data.enabled,
      created_by: context.userId,
    };

    const { data: saved, error } = data.id
      ? await supabaseAdmin
          .from("public_coupons")
          .update(payload)
          .eq("id", data.id)
          .select("id")
          .single()
      : await supabaseAdmin.from("public_coupons").insert(payload).select("id").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "public_coupon.updated" : "public_coupon.created",
      entityType: "public_coupon",
      entityId: (saved as { id: string }).id,
      oldData: previous,
      newData: payload,
    });

    return { id: (saved as { id: string }).id };
  });

export const adminArchivePublicCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { error } = await supabaseAdmin
      .from("public_coupons")
      .update({ archived: true, enabled: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "public_coupon.archived",
      entityType: "public_coupon",
      entityId: data.id,
    });
    return { ok: true };
  });

export const adminSetPublicCouponEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { error } = await supabaseAdmin
      .from("public_coupons")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "public_coupon.set_enabled",
      entityType: "public_coupon",
      entityId: data.id,
      newData: { enabled: data.enabled },
    });
    return { ok: true };
  });
