// Universal CORE Affiliate System -- the createServerFn surface. Business
// logic lives in affiliate.server.ts (called both from here and directly
// from the Stripe/PayPal webhooks); this file is the thin, auth-gated
// wrapper, matching the *.server.ts/*.functions.ts split used throughout
// this codebase. See PROJECT_KNOWLEDGE.md -> Affiliate System.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import type { Json } from "@/integrations/supabase/types";
import {
  becomeAffiliate,
  getAffiliateStatus,
  getEligibleAffiliateOffers,
  getOrCreateAffiliateLink,
  isConversionApproved,
  recordAffiliateClick,
  recordPendingAttribution,
  reverseAffiliateConversion,
} from "@/lib/affiliate.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ---------- Public (unauthenticated -- an Affiliate link is clicked by
// anyone, logged in or not) ----------

export const resolveAffiliateClick = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ code: z.string().trim().min(1) }).parse(raw))
  .handler(async ({ data }) => recordAffiliateClick(data.code));

// ---------- User-facing ----------

export const getMyAffiliateStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => ({ status: await getAffiliateStatus(context.userId) }));

export const joinAffiliateProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => becomeAffiliate(context.userId));

export const getAffiliateCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const offers = await getEligibleAffiliateOffers();
    return offers.map((o) => ({
      id: o.id,
      titleBs: o.title_bs,
      titleEn: o.title_en,
      titleDe: o.title_de,
      commissionType: o.commission_type,
      commissionRate: o.commission_rate,
      commissionFixedAmount: o.commission_fixed_amount,
      currency: o.currency,
    }));
  });

export const getMyAffiliateLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ offerId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => getOrCreateAffiliateLink(context.userId, data.offerId));

// Bridges a CORE-native checkout to later webhook fulfillment (see
// affiliate.server.ts's recordPendingAttribution) -- called by the client
// right before creating a payment reference (createPaymentReference /
// createPointsPurchaseReference), only when it has a stored affiliate
// code (src/lib/affiliate-tracking.ts).
export const registerCheckoutAttribution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        sourceProductType: z.string().trim().min(1),
        sourceProductId: z.string().trim().min(1),
        affiliateCode: z.string().trim().min(1),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    await recordPendingAttribution({
      userId: context.userId,
      sourceProductType: data.sourceProductType,
      sourceProductId: data.sourceProductId,
      affiliateCode: data.affiliateCode,
    });
    return { ok: true };
  });

export type AffiliateDashboardData = {
  status: Awaited<ReturnType<typeof getAffiliateStatus>>;
  clicksCount: number;
  conversions: {
    pendingCount: number;
    approvedCount: number;
    paidCount: number;
    reversedCount: number;
    pendingAmount: number;
    approvedAmount: number;
    paidAmount: number;
    currency: string;
  };
  payoutThreshold: number;
  nextPayout: { amount: number; status: string; createdAt: string } | null;
  recentConversions: {
    id: string;
    offerTitle: string;
    commissionAmount: number;
    currency: string;
    status: "pending" | "approved" | "paid" | "reversed";
    createdAt: string;
  }[];
};

export const getMyAffiliateDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AffiliateDashboardData> => {
    const supabaseAdmin = await adminClient();
    const status = await getAffiliateStatus(context.userId);

    const { data: links } = await supabaseAdmin
      .from("affiliate_links")
      .select("id")
      .eq("affiliate_user_id", context.userId);
    const linkIds = (links ?? []).map((l) => l.id);
    const { count: clicksCount } = linkIds.length
      ? await supabaseAdmin
          .from("affiliate_clicks")
          .select("id", { count: "exact", head: true })
          .in("link_id", linkIds)
      : { count: 0 };

    const { data: conversions } = await supabaseAdmin
      .from("affiliate_conversions")
      .select(
        "id, status, created_at, return_period_days, commission_amount, currency, payout_id, affiliate_offers(title_bs, title_en, title_de)",
      )
      .eq("affiliate_user_id", context.userId)
      .order("created_at", { ascending: false });

    const rows = conversions ?? [];
    let pendingCount = 0;
    let approvedCount = 0;
    let paidCount = 0;
    let reversedCount = 0;
    let pendingAmount = 0;
    let approvedAmount = 0;
    let paidAmount = 0;
    let currency = "EUR";

    const { data: payouts } = await supabaseAdmin
      .from("affiliate_payouts")
      .select("id, status")
      .eq("affiliate_user_id", context.userId);
    const paidPayoutIds = new Set(
      (payouts ?? []).filter((p) => p.status === "paid").map((p) => p.id),
    );

    const recentConversions: AffiliateDashboardData["recentConversions"] = [];
    for (const c of rows) {
      currency = c.currency;
      const isPaid = !!c.payout_id && paidPayoutIds.has(c.payout_id);
      let effectiveStatus: "pending" | "approved" | "paid" | "reversed";
      if (c.status === "reversed") {
        effectiveStatus = "reversed";
        reversedCount += 1;
      } else if (isPaid) {
        effectiveStatus = "paid";
        paidCount += 1;
        paidAmount += Number(c.commission_amount);
      } else if (isConversionApproved(c)) {
        effectiveStatus = "approved";
        approvedCount += 1;
        approvedAmount += Number(c.commission_amount);
      } else {
        effectiveStatus = "pending";
        pendingCount += 1;
        pendingAmount += Number(c.commission_amount);
      }
      if (recentConversions.length < 20) {
        const offer = c.affiliate_offers as {
          title_bs: string;
          title_en: string;
          title_de: string;
        } | null;
        recentConversions.push({
          id: c.id,
          offerTitle: offer?.title_en ?? "",
          commissionAmount: Number(c.commission_amount),
          currency: c.currency,
          status: effectiveStatus,
          createdAt: c.created_at,
        });
      }
    }

    const { data: thresholdRow } = await supabaseAdmin
      .from("affiliate_config")
      .select("value")
      .eq("key", "payout_threshold_eur")
      .maybeSingle();

    const { data: nextPayoutRow } = await supabaseAdmin
      .from("affiliate_payouts")
      .select("amount, status, created_at")
      .eq("affiliate_user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      status,
      clicksCount: clicksCount ?? 0,
      conversions: {
        pendingCount,
        approvedCount,
        paidCount,
        reversedCount,
        pendingAmount,
        approvedAmount,
        paidAmount,
        currency,
      },
      payoutThreshold: Number(thresholdRow?.value ?? 50),
      nextPayout: nextPayoutRow
        ? {
            amount: Number(nextPayoutRow.amount),
            status: nextPayoutRow.status,
            createdAt: nextPayoutRow.created_at,
          }
        : null,
      recentConversions,
    };
  });

// ---------- Admin ----------

export const adminListAffiliateOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data } = await supabaseAdmin
      .from("affiliate_offers")
      .select("*, applications(name)")
      .eq("archived", false)
      .order("display_order", { ascending: false });
    return data ?? [];
  });

const offerUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  sourceType: z.enum(["core", "application"]),
  sourceAppId: z.string().uuid().optional(),
  sourceProductType: z.string().trim().min(1),
  sourceProductId: z.string().trim().min(1),
  titleBs: z.string().min(1),
  titleEn: z.string().min(1),
  titleDe: z.string().min(1),
  descriptionBs: z.string().optional(),
  descriptionEn: z.string().optional(),
  descriptionDe: z.string().optional(),
  destinationUrl: z.string().trim().min(1),
  commissionType: z.enum(["percent", "fixed"]),
  commissionRate: z.number().positive().max(100).optional(),
  commissionFixedAmount: z.number().nonnegative().optional(),
  currency: z.string().trim().length(3).default("EUR"),
  attributionWindowDays: z.number().int().positive().optional(),
  returnPeriodDays: z.number().int().nonnegative().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(false),
});

export const adminUpsertAffiliateOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => offerUpsertSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    if (data.sourceType === "application" && !data.sourceAppId) {
      throw new Error("sourceAppId is required for an application-sourced offer.");
    }
    if (!/^https?:\/\//.test(data.destinationUrl) && !data.destinationUrl.startsWith("/")) {
      throw new Error("destinationUrl must be an internal path or an http(s) URL.");
    }

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("affiliate_offers")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      source_type: data.sourceType,
      source_app_id: data.sourceType === "application" ? data.sourceAppId : null,
      source_product_type: data.sourceProductType,
      source_product_id: data.sourceProductId,
      title_bs: data.titleBs,
      title_en: data.titleEn,
      title_de: data.titleDe,
      description_bs: data.descriptionBs ?? null,
      description_en: data.descriptionEn ?? null,
      description_de: data.descriptionDe ?? null,
      destination_url: data.destinationUrl,
      commission_type: data.commissionType,
      commission_rate: data.commissionType === "percent" ? (data.commissionRate ?? null) : null,
      commission_fixed_amount:
        data.commissionType === "fixed" ? (data.commissionFixedAmount ?? null) : null,
      currency: data.currency,
      attribution_window_days: data.attributionWindowDays ?? null,
      return_period_days: data.returnPeriodDays ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      created_by: context.userId,
    };

    const { data: saved, error } = data.id
      ? await supabaseAdmin
          .from("affiliate_offers")
          .update(payload)
          .eq("id", data.id)
          .select("id")
          .single()
      : await supabaseAdmin.from("affiliate_offers").insert(payload).select("id").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "affiliate_offer.updated" : "affiliate_offer.created",
      entityType: "affiliate_offer",
      entityId: (saved as { id: string }).id,
      oldData: previous,
      newData: payload,
    });

    return { id: (saved as { id: string }).id };
  });

export const adminSetAffiliateOfferEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { error } = await supabaseAdmin
      .from("affiliate_offers")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "affiliate_offer.set_enabled",
      entityType: "affiliate_offer",
      entityId: data.id,
      newData: { enabled: data.enabled },
    });
    return { ok: true };
  });

export const adminArchiveAffiliateOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { error } = await supabaseAdmin
      .from("affiliate_offers")
      .update({ archived: true, enabled: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "affiliate_offer.archived",
      entityType: "affiliate_offer",
      entityId: data.id,
    });
    return { ok: true };
  });

export const adminListAffiliates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data } = await supabaseAdmin
      .from("affiliates")
      .select("*, profiles!affiliates_user_id_fkey(username, first_name, last_name, email)")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const adminSetAffiliateStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        status: z.enum(["active", "suspended", "disabled"]),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { error } = await supabaseAdmin
      .from("affiliates")
      .update({
        status: data.status,
        suspended_reason: data.status === "active" ? null : (data.reason ?? null),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "affiliate.set_status",
      entityType: "affiliate",
      entityId: data.userId,
      newData: { status: data.status },
      reason: data.reason,
    });
    if (data.status === "suspended" || data.status === "disabled") {
      const { sendNotification } = await import("@/lib/notify.server");
      await sendNotification({
        userId: data.userId,
        category: "affiliate",
        type: "warning",
        dedupeKey: `affiliate-status:${data.userId}:${data.status}:${Date.now()}`,
        content: {
          titleBs: "Affiliate status promijenjen",
          titleEn: "Affiliate status changed",
          titleDe: "Affiliate-Status geändert",
          messageBs: `Tvoj Affiliate status je promijenjen u: ${data.status}.`,
          messageEn: `Your Affiliate status has been changed to: ${data.status}.`,
          messageDe: `Dein Affiliate-Status wurde geändert zu: ${data.status}.`,
        },
      });
    }
    return { ok: true };
  });

export const adminListAffiliateConversions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data } = await supabaseAdmin
      .from("affiliate_conversions")
      .select(
        "*, affiliate_offers(title_bs, title_en, title_de, source_type, source_app_id), profiles!affiliate_conversions_affiliate_user_id_fkey(username)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

export const adminReverseAffiliateConversion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        transactionRef: z.string().trim().min(1),
        reason: z.string().trim().min(1).max(500),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const result = await reverseAffiliateConversion(data.transactionRef, data.reason);
    await writeAuditLog({
      userId: context.userId,
      action: "affiliate_conversion.reversed",
      entityType: "affiliate_conversion",
      entityId: data.transactionRef,
      reason: data.reason,
      newData: result,
    });
    return result;
  });

export const adminListAffiliatePayouts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data } = await supabaseAdmin
      .from("affiliate_payouts")
      .select(
        "*, profiles!affiliate_payouts_affiliate_user_id_fkey(username, first_name, last_name)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

// The one manual step this codebase's lack of an automated external
// payout provider requires (spec section 23) -- Admin confirms the money
// was actually sent (bank transfer, manual PayPal Payout, etc.) and
// records the reference. Never invoked automatically.
export const adminMarkAffiliatePayoutPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), payoutReference: z.string().trim().min(1) }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data: payout, error } = await supabaseAdmin
      .from("affiliate_payouts")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payout_reference: data.payoutReference,
      })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("affiliate_user_id, amount, currency")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!payout) throw new Error("payout_not_pending");

    await writeAuditLog({
      userId: context.userId,
      action: "affiliate_payout.marked_paid",
      entityType: "affiliate_payout",
      entityId: data.id,
      newData: { payoutReference: data.payoutReference },
    });

    const { sendNotification } = await import("@/lib/notify.server");
    await sendNotification({
      userId: payout.affiliate_user_id,
      category: "affiliate",
      type: "success",
      targetPath: "/dashboard/affiliate",
      dedupeKey: `affiliate-payout-paid:${data.id}`,
      content: {
        titleBs: "Isplata izvršena",
        titleEn: "Payout completed",
        titleDe: "Auszahlung abgeschlossen",
        messageBs: `${Number(payout.amount).toFixed(2)} ${payout.currency} je isplaćeno.`,
        messageEn: `${Number(payout.amount).toFixed(2)} ${payout.currency} has been paid out.`,
        messageDe: `${Number(payout.amount).toFixed(2)} ${payout.currency} wurde ausgezahlt.`,
      },
    });

    return { ok: true };
  });

export const adminListAffiliateConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data } = await supabaseAdmin.from("affiliate_config").select("*").order("key");
    return data ?? [];
  });

export const adminSetAffiliateConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ key: z.string().trim().min(1), value: z.unknown() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { error } = await supabaseAdmin
      .from("affiliate_config")
      .upsert({ key: data.key, value: data.value as Json, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "affiliate_config.updated",
      entityType: "affiliate_config",
      entityId: data.key,
      newData: { value: data.value },
    });
    return { ok: true };
  });
