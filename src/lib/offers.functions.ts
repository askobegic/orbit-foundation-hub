// Priority 17: Dashboard Offers (Global + Individual).
//
// Business logic here mirrors the Rewards/Advertising module conventions
// throughout this codebase: server functions are thin, business logic is
// small pure helpers, admin writes always go through assertAdmin() +
// writeAuditLog(), and a discount/final price is NEVER computed
// client-side -- resolveMyOffers() always re-derives the real base price
// from the referenced product server-side before applying the discount.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import { hasAnyActivePremium } from "@/lib/premium";
import { resolveAudience, sendBulkNotifications, sendNotification } from "@/lib/notify.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// Notifies the offer's own target audience the moment it becomes enabled
// -- "Admin-created offer notification" (CORE Notification & User
// Engagement System). Reuses the same segment vocabulary
// resolveMyOffers()/adminSendNotification already use (all/standard/
// premium), never a second one. dedupeKey is scoped to the offer id, so
// disabling and re-enabling the same offer later doesn't re-notify --
// deliberately conservative, see PROJECT_KNOWLEDGE.md -> Notifications &
// User Engagement.
type OfferForNotify = {
  id: string;
  offer_type: "global" | "individual";
  target_segment: "all" | "standard" | "premium" | null;
  target_user_id: string | null;
  title_bs: string;
  title_en: string;
  title_de: string;
};

async function notifyOfferPublished(
  supabaseAdmin: Awaited<ReturnType<typeof adminClient>>,
  offer: OfferForNotify,
): Promise<void> {
  const content = {
    titleBs: "Nova ponuda za vas",
    titleEn: "A new offer for you",
    titleDe: "Ein neues Angebot für Sie",
    messageBs: offer.title_bs,
    messageEn: offer.title_en,
    messageDe: offer.title_de,
  };
  const dedupeKey = `offer:${offer.id}`;
  const targetPath = "/dashboard";

  if (offer.offer_type === "individual") {
    if (!offer.target_user_id) return;
    await sendNotification({
      userId: offer.target_user_id,
      category: "offer",
      targetPath,
      dedupeKey,
      content,
    });
    return;
  }
  if (!offer.target_segment) return;
  const userIds = await resolveAudience(supabaseAdmin, offer.target_segment);
  await sendBulkNotifications({ userIds, category: "offer", targetPath, dedupeKey, content });
}

export interface ResolvedProduct {
  name: string;
  basePrice: number;
  currency: string;
}

// The one place a product's real, current price is looked up -- both
// resolveMyOffers() and the coupon module (coupons.functions.ts) call
// this rather than each re-implementing the polymorphic lookup.
export async function resolveProduct(
  supabaseClient: Awaited<ReturnType<typeof adminClient>>,
  productType: string,
  productId: string,
): Promise<ResolvedProduct | null> {
  if (productType === "subscription_plan") {
    const { data } = await supabaseClient
      .from("subscription_plans")
      .select("name, price, currency, is_active")
      .eq("id", productId)
      .maybeSingle();
    if (!data || !(data as { is_active: boolean }).is_active) return null;
    const row = data as { name: string; price: number; currency: string };
    return { name: row.name, basePrice: Number(row.price), currency: row.currency ?? "EUR" };
  }
  if (productType === "ad_placement_price") {
    const { data } = await supabaseClient
      .from("ad_placement_prices")
      .select("price, currency, enabled, archived, placement_key, ad_placements(label)")
      .eq("id", productId)
      .maybeSingle();
    if (!data) return null;
    const row = data as {
      price: number;
      currency: string;
      enabled: boolean;
      archived: boolean;
      placement_key: string;
      ad_placements: { label: string } | null;
    };
    if (!row.enabled || row.archived) return null;
    return {
      name: row.ad_placements?.label ?? row.placement_key,
      basePrice: Number(row.price),
      currency: row.currency ?? "EUR",
    };
  }
  return null;
}

// Priority 17 pricing model -- important, and easy to get backwards:
// this codebase has no dynamic Checkout Session creation anywhere
// (static, admin-configured Stripe/PayPal Payment Links only). That means
// the REAL, actually-charged amount for any offer/coupon is always the
// referenced product's own current price (resolveProduct's basePrice) --
// there is no mechanism to charge a computed discount at payment time.
// The admin is therefore responsible for pointing product_id at whichever
// plan/price row is ALREADY priced at the intended discounted amount.
// discount_percent/fixed_price are DISPLAY-ONLY marketing context: for a
// percent discount, the crossed-out "was" price is reverse-derived from
// the real price (mathematically exact, not guessed); a fixed_price
// discount has no clean reverse derivation without a second admin-
// entered reference price, so no strikethrough is shown for it -- never
// silently invented. Getting this backwards (computing a "discounted"
// price forward from the real price and presenting it as final) would
// show the customer a number that doesn't match what they're actually
// charged -- exactly the kind of client-trust/display bug the Security
// Rules exist to prevent, even though no money-handling code is affected
// either way (the webhook always verifies against the real plan price).
export function resolveDisplayPricing(
  realPrice: number,
  discountType: string,
  discountPercent: number | null,
): { finalPrice: number; wasPrice: number | null } {
  if (discountType === "percent" && discountPercent != null && discountPercent < 100) {
    const wasPrice = Math.round((realPrice / (1 - discountPercent / 100)) * 100) / 100;
    return { finalPrice: realPrice, wasPrice };
  }
  return { finalPrice: realPrice, wasPrice: null };
}

export interface ResolvedOffer {
  id: string;
  offerType: "global" | "individual";
  productType: string;
  productId: string;
  productName: string;
  titleBs: string;
  titleEn: string;
  titleDe: string;
  descriptionBs: string | null;
  descriptionEn: string | null;
  descriptionDe: string | null;
  ctaBs: string | null;
  ctaEn: string | null;
  ctaDe: string | null;
  badgeIcon: string | null;
  discountType: string;
  discountPercent: number | null;
  fixedPrice: number | null;
  // finalPrice is always the referenced product's real, actually-charged
  // price. wasPrice is a reverse-derived, display-only strikethrough
  // (percent discounts only) -- see resolveDisplayPricing's comment.
  finalPrice: number;
  wasPrice: number | null;
  currency: string;
  startsAt: string;
  endsAt: string;
  priority: number;
}

// ---------- Public: resolve the current user's eligible offers ----------

export const resolveMyOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResolvedOffer[]> => {
    const now = new Date().toISOString();
    const supabaseAdmin = await adminClient();

    // RLS already scopes this to eligible rows (own individual offers +
    // all enabled global offers); segment matching for global offers and
    // the starts_at/ends_at window are both re-checked here explicitly
    // rather than trusted from the broader RLS boundary.
    const { data: rows } = await context.supabase
      .from("dashboard_offers")
      .select("*")
      .lte("starts_at", now)
      .gte("ends_at", now)
      .order("priority", { ascending: false });

    if (!rows || rows.length === 0) return [];

    const isPremium = await hasAnyActivePremium(context.userId);

    const eligible = (
      rows as Array<{
        id: string;
        offer_type: string;
        target_segment: string | null;
        target_user_id: string | null;
        product_type: string;
        product_id: string;
        title_bs: string;
        title_en: string;
        title_de: string;
        description_bs: string | null;
        description_en: string | null;
        description_de: string | null;
        cta_bs: string | null;
        cta_en: string | null;
        cta_de: string | null;
        badge_icon: string | null;
        discount_type: string;
        discount_percent: number | null;
        fixed_price: number | null;
        starts_at: string;
        ends_at: string;
        priority: number;
      }>
    ).filter((o) => {
      if (o.offer_type === "individual") return o.target_user_id === context.userId;
      // Global: segment matching. Extensible by design -- 'all' always
      // matches, 'standard'/'premium' key off the same single Premium
      // resolver every other surface in this codebase uses. A future
      // segment key added to offer_segments simply won't match anyone
      // until this resolver (or a later, more granular one) knows about
      // it -- fails closed, never shown to the wrong audience by default.
      if (o.target_segment === "all") return true;
      if (o.target_segment === "standard") return !isPremium;
      if (o.target_segment === "premium") return isPremium;
      return false;
    });

    const resolved: ResolvedOffer[] = [];
    for (const o of eligible) {
      const product = await resolveProduct(supabaseAdmin, o.product_type, o.product_id);
      if (!product) continue; // referenced product no longer valid/active -- silently skip, not an error
      resolved.push({
        id: o.id,
        offerType: o.offer_type as "global" | "individual",
        productType: o.product_type,
        productId: o.product_id,
        productName: product.name,
        titleBs: o.title_bs,
        titleEn: o.title_en,
        titleDe: o.title_de,
        descriptionBs: o.description_bs,
        descriptionEn: o.description_en,
        descriptionDe: o.description_de,
        ctaBs: o.cta_bs,
        ctaEn: o.cta_en,
        ctaDe: o.cta_de,
        badgeIcon: o.badge_icon,
        discountType: o.discount_type,
        discountPercent: o.discount_percent,
        fixedPrice: o.fixed_price,
        ...resolveDisplayPricing(product.basePrice, o.discount_type, o.discount_percent),
        currency: product.currency,
        startsAt: o.starts_at,
        endsAt: o.ends_at,
        priority: o.priority,
      });
    }

    // Deterministic ordering (spec: priority first, then individual before
    // global as a tiebreaker, then soonest-ending first).
    resolved.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (a.offerType !== b.offerType) return a.offerType === "individual" ? -1 : 1;
      return new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime();
    });
    return resolved;
  });

// ---------- Admin ----------

export const adminListOfferSegments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data } = await supabaseAdmin
      .from("offer_segments")
      .select("*")
      .eq("archived", false)
      .order("display_order", { ascending: true });
    return data ?? [];
  });

export const adminListDashboardOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ offerType: z.enum(["global", "individual"]) }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data: rows } = await supabaseAdmin
      .from("dashboard_offers")
      .select("*, target_user:profiles!dashboard_offers_target_user_id_fkey(id, username, first_name, last_name)")
      .eq("offer_type", data.offerType)
      .eq("archived", false)
      .order("created_at", { ascending: false });
    return rows ?? [];
  });

const offerUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  offerType: z.enum(["global", "individual"]),
  targetSegment: z.string().min(1).optional(),
  targetUserId: z.string().uuid().optional(),
  productType: z.enum(["subscription_plan", "ad_placement_price"]),
  productId: z.string().uuid(),
  titleBs: z.string().min(1),
  titleEn: z.string().min(1),
  titleDe: z.string().min(1),
  descriptionBs: z.string().optional(),
  descriptionEn: z.string().optional(),
  descriptionDe: z.string().optional(),
  ctaBs: z.string().optional(),
  ctaEn: z.string().optional(),
  ctaDe: z.string().optional(),
  badgeIcon: z.string().optional(),
  discountType: z.enum(["percent", "fixed_price"]),
  discountPercent: z.number().positive().max(100).optional(),
  fixedPrice: z.number().nonnegative().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
});

export const adminUpsertDashboardOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => offerUpsertSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    // Validate the referenced product genuinely exists -- no cross-table
    // FK is possible for a polymorphic reference, so this is the
    // server-side substitute, checked on every write, not just at
    // display time.
    const product = await resolveProduct(supabaseAdmin, data.productType, data.productId);
    if (!product) throw new Error("Referenced product not found or inactive.");

    if (data.offerType === "global" && !data.targetSegment) {
      throw new Error("targetSegment is required for a global offer.");
    }
    if (data.offerType === "individual" && !data.targetUserId) {
      throw new Error("targetUserId is required for an individual offer.");
    }

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("dashboard_offers")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      offer_type: data.offerType,
      target_segment: data.offerType === "global" ? data.targetSegment : null,
      target_user_id: data.offerType === "individual" ? data.targetUserId : null,
      product_type: data.productType,
      product_id: data.productId,
      title_bs: data.titleBs,
      title_en: data.titleEn,
      title_de: data.titleDe,
      description_bs: data.descriptionBs ?? null,
      description_en: data.descriptionEn ?? null,
      description_de: data.descriptionDe ?? null,
      cta_bs: data.ctaBs ?? null,
      cta_en: data.ctaEn ?? null,
      cta_de: data.ctaDe ?? null,
      badge_icon: data.badgeIcon ?? null,
      discount_type: data.discountType,
      discount_percent: data.discountType === "percent" ? (data.discountPercent ?? null) : null,
      fixed_price: data.discountType === "fixed_price" ? (data.fixedPrice ?? null) : null,
      starts_at: data.startsAt,
      ends_at: data.endsAt,
      priority: data.priority,
      enabled: data.enabled,
      created_by: context.userId,
    };

    const { data: saved, error } = data.id
      ? await supabaseAdmin
          .from("dashboard_offers")
          .update(payload)
          .eq("id", data.id)
          .select("id")
          .single()
      : await supabaseAdmin.from("dashboard_offers").insert(payload).select("id").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "dashboard_offer.updated" : "dashboard_offer.created",
      entityType: "dashboard_offer",
      entityId: (saved as { id: string }).id,
      oldData: previous,
      newData: payload,
    });

    // Only a brand-new offer created already-enabled counts as "publish"
    // here -- an existing offer's other fields being edited never
    // re-notifies (that's adminSetDashboardOfferEnabled's job, below, on
    // an explicit disabled -> enabled transition).
    if (!data.id && data.enabled) {
      await notifyOfferPublished(supabaseAdmin, {
        id: (saved as { id: string }).id,
        offer_type: data.offerType,
        target_segment:
          (payload.target_segment as OfferForNotify["target_segment"] | undefined) ?? null,
        target_user_id: payload.target_user_id ?? null,
        title_bs: data.titleBs,
        title_en: data.titleEn,
        title_de: data.titleDe,
      });
    }

    return { id: (saved as { id: string }).id };
  });

export const adminArchiveDashboardOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { error } = await supabaseAdmin
      .from("dashboard_offers")
      .update({ archived: true, enabled: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "dashboard_offer.archived",
      entityType: "dashboard_offer",
      entityId: data.id,
    });
    return { ok: true };
  });

export const adminSetDashboardOfferEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("dashboard_offers")
      .select("enabled, offer_type, target_segment, target_user_id, title_bs, title_en, title_de")
      .eq("id", data.id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("dashboard_offers")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "dashboard_offer.set_enabled",
      entityType: "dashboard_offer",
      entityId: data.id,
      newData: { enabled: data.enabled },
    });

    // "Publish" here means an explicit disabled -> enabled transition --
    // toggling an already-enabled offer, or disabling one, never notifies.
    if (previous && !previous.enabled && data.enabled) {
      await notifyOfferPublished(supabaseAdmin, {
        id: data.id,
        offer_type: previous.offer_type as OfferForNotify["offer_type"],
        target_segment: previous.target_segment as OfferForNotify["target_segment"],
        target_user_id: previous.target_user_id,
        title_bs: previous.title_bs,
        title_en: previous.title_en,
        title_de: previous.title_de,
      });
    }

    return { ok: true };
  });

// Admin user picker for Individual Offers -- reuses the existing
// adminListUsers search, not a second user-search implementation.
export const adminSearchUsersForOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ search: z.string().min(1) }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data: rows } = await supabaseAdmin
      .from("profiles")
      .select("id, username, first_name, last_name, email")
      .or(`username.ilike.%${data.search}%,email.ilike.%${data.search}%`)
      .limit(10);
    return rows ?? [];
  });
