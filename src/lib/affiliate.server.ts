// Universal CORE Affiliate System -- core business logic. See
// PROJECT_KNOWLEDGE.md -> Affiliate System for the full architecture.
//
// Reuses rather than duplicates: hasAnyActivePremium/resolveProduct (offer
// pricing for CORE-native offers), capability_definitions/
// application_capabilities (per-application Affiliate ON/OFF), sendNotification
// (every Affiliate notification), writeAuditLog (every admin mutation),
// resource_references (the "has this user become an Affiliate" signal the
// existing Dashboard Actions "Postani Affiliate" prompt gates on).
import { randomBytes } from "node:crypto";

import { sendNotification } from "@/lib/notify.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type SupabaseAdmin = Awaited<ReturnType<typeof admin>>;

async function getConfig(supabaseAdmin: SupabaseAdmin, key: string): Promise<unknown> {
  const { data } = await supabaseAdmin
    .from("affiliate_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return data?.value;
}

async function isGloballyEnabled(supabaseAdmin: SupabaseAdmin): Promise<boolean> {
  return (await getConfig(supabaseAdmin, "enabled")) === true;
}

async function isAffiliateCapabilityEnabledForApp(
  supabaseAdmin: SupabaseAdmin,
  appId: string,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("application_capabilities")
    .select("capability_key, capability_definitions!inner(enabled, archived)")
    .eq("app_id", appId)
    .eq("capability_key", "affiliate")
    .eq("enabled", true)
    .eq("capability_definitions.enabled", true)
    .eq("capability_definitions.archived", false)
    .maybeSingle();
  return !!data;
}

type OfferRow = {
  id: string;
  source_type: "core" | "application";
  source_app_id: string | null;
  source_product_type: string;
  source_product_id: string;
  title_bs: string;
  title_en: string;
  title_de: string;
  destination_url: string;
  commission_type: "percent" | "fixed";
  commission_rate: number | null;
  commission_fixed_amount: number | null;
  currency: string;
  attribution_window_days: number | null;
  return_period_days: number | null;
  enabled: boolean;
  archived: boolean;
};

// Final eligibility (spec section 5): Global Affiliate ON AND (offer is
// CORE-native OR the source application has the `affiliate` capability
// enabled) AND the offer itself is enabled/non-archived. Does not check
// the *affiliate's own* status -- that's checked separately at conversion/
// link-creation time, since catalog visibility and "can this specific
// affiliate earn from it" are different questions (an eligible catalog is
// shown to any user considering becoming an Affiliate, including one who
// isn't yet).
async function isOfferCurrentlyEligible(
  supabaseAdmin: SupabaseAdmin,
  offer: OfferRow,
): Promise<boolean> {
  if (!offer.enabled || offer.archived) return false;
  if (!(await isGloballyEnabled(supabaseAdmin))) return false;
  if (offer.source_type === "application") {
    if (!offer.source_app_id) return false;
    if (!(await isAffiliateCapabilityEnabledForApp(supabaseAdmin, offer.source_app_id)))
      return false;
  }
  return true;
}

// ---------- Affiliate status ----------

export type AffiliateStatus = "not_affiliate" | "active" | "suspended" | "disabled";

export async function getAffiliateStatus(userId: string): Promise<AffiliateStatus> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("affiliates")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.status as AffiliateStatus | undefined) ?? "not_affiliate";
}

export async function becomeAffiliate(userId: string): Promise<{ ok: boolean; reason?: string }> {
  const supabaseAdmin = await admin();
  if (!(await isGloballyEnabled(supabaseAdmin)))
    return { ok: false, reason: "affiliate_program_disabled" };

  const { data: existing } = await supabaseAdmin
    .from("affiliates")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return { ok: false, reason: `already_${existing.status}` };

  const { error } = await supabaseAdmin
    .from("affiliates")
    .insert({ user_id: userId, status: "active" });
  if (error) {
    console.error("becomeAffiliate: insert failed", error);
    return { ok: false, reason: "insert_failed" };
  }

  // Priority 21's Dashboard Actions "Postani Affiliate" prompt is gated on
  // requires_missing_resource_type='affiliate_account' -- creating this
  // resource is what makes that prompt stop appearing, and (via the
  // existing "My Resources" section) makes an "Affiliate -- active" card
  // start appearing, entirely through the existing, unmodified mechanism.
  await supabaseAdmin.from("resource_references").upsert(
    {
      user_id: userId,
      app_id: null,
      resource_type: "affiliate_account",
      label: "Affiliate",
      status: "active",
      destination: "/dashboard/affiliate",
    },
    { onConflict: "user_id,app_id,resource_type" },
  );

  await sendNotification({
    userId,
    category: "affiliate",
    type: "success",
    targetPath: "/dashboard/affiliate",
    dedupeKey: `affiliate-activated:${userId}`,
    content: {
      titleBs: "Affiliate nalog aktiviran",
      titleEn: "Affiliate account activated",
      titleDe: "Affiliate-Konto aktiviert",
      messageBs: "Sada možeš promovirati odobrene proizvode i usluge i ostvarivati proviziju.",
      messageEn: "You can now promote approved products and services and earn commission.",
      messageDe:
        "Du kannst jetzt genehmigte Produkte und Dienstleistungen bewerben und Provision verdienen.",
    },
  });

  return { ok: true };
}

// ---------- Catalog / links / clicks ----------

export async function getEligibleAffiliateOffers(): Promise<OfferRow[]> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("affiliate_offers")
    .select("*")
    .eq("enabled", true)
    .eq("archived", false)
    .order("display_order", { ascending: false });
  const offers = (data ?? []) as OfferRow[];
  if (!(await isGloballyEnabled(supabaseAdmin))) return [];

  const appIds = [
    ...new Set(offers.map((o) => o.source_app_id).filter((id): id is string => !!id)),
  ];
  const eligibleAppIds = new Set<string>();
  for (const appId of appIds) {
    if (await isAffiliateCapabilityEnabledForApp(supabaseAdmin, appId)) eligibleAppIds.add(appId);
  }
  return offers.filter(
    (o) => o.source_type === "core" || (o.source_app_id && eligibleAppIds.has(o.source_app_id)),
  );
}

function generateLinkCode(): string {
  return randomBytes(9).toString("base64url");
}

export async function getOrCreateAffiliateLink(
  affiliateUserId: string,
  offerId: string,
): Promise<{ ok: boolean; code?: string; reason?: string }> {
  const supabaseAdmin = await admin();
  const status = await getAffiliateStatus(affiliateUserId);
  if (status !== "active") return { ok: false, reason: `affiliate_${status}` };

  const { data: offer } = await supabaseAdmin
    .from("affiliate_offers")
    .select("*")
    .eq("id", offerId)
    .maybeSingle();
  if (!offer || !(await isOfferCurrentlyEligible(supabaseAdmin, offer as OfferRow))) {
    return { ok: false, reason: "offer_not_eligible" };
  }

  const { data: existing } = await supabaseAdmin
    .from("affiliate_links")
    .select("code")
    .eq("affiliate_user_id", affiliateUserId)
    .eq("offer_id", offerId)
    .maybeSingle();
  if (existing) return { ok: true, code: existing.code };

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLinkCode();
    const { error } = await supabaseAdmin
      .from("affiliate_links")
      .insert({ affiliate_user_id: affiliateUserId, offer_id: offerId, code });
    if (!error) return { ok: true, code };
    if (error.code !== "23505") {
      console.error("getOrCreateAffiliateLink: insert failed", error);
      return { ok: false, reason: "insert_failed" };
    }
    // 23505 on the (affiliate_user_id, offer_id) unique key means a
    // concurrent request already created it -- re-fetch and use that one.
    const { data: raced } = await supabaseAdmin
      .from("affiliate_links")
      .select("code")
      .eq("affiliate_user_id", affiliateUserId)
      .eq("offer_id", offerId)
      .maybeSingle();
    if (raced) return { ok: true, code: raced.code };
    // Otherwise the 23505 was on `code` itself (astronomically unlikely) --
    // loop and generate a fresh one.
  }
  return { ok: false, reason: "code_generation_failed" };
}

export type ResolvedClick = {
  destinationUrl: string;
  offerId: string;
  sourceProductType: string;
  sourceProductId: string;
};

// Records a click (minimal: which link, when -- no IP/UA/surveillance
// data, spec section 17) and resolves where to redirect. Returns null for
// an unknown code or an offer that's no longer eligible -- the redirect
// route falls back to the CORE homepage in that case.
export async function recordAffiliateClick(code: string): Promise<ResolvedClick | null> {
  const supabaseAdmin = await admin();
  const { data: link } = await supabaseAdmin
    .from("affiliate_links")
    .select("id, offer_id, affiliate_user_id, affiliate_offers(*)")
    .eq("code", code)
    .maybeSingle();
  if (!link) return null;
  const offer = link.affiliate_offers as unknown as OfferRow | null;
  if (!offer || !(await isOfferCurrentlyEligible(supabaseAdmin, offer))) return null;
  if ((await getAffiliateStatus(link.affiliate_user_id)) !== "active") return null;

  await supabaseAdmin.from("affiliate_clicks").insert({ link_id: link.id });

  return {
    destinationUrl: offer.destination_url,
    offerId: offer.id,
    sourceProductType: offer.source_product_type,
    sourceProductId: offer.source_product_id,
  };
}

// Bridges a CORE-native checkout (no dynamic Checkout Session, so no
// channel to carry the code through the payment provider -- see
// payment-reference.server.ts) to later webhook fulfillment. Called by
// createPaymentReference/createPointsPurchaseReference-style functions
// right before they sign and return the reference, only when the client
// reports an affiliate code it captured client-side. Deliberately does
// NOT validate the click/window here (that happens once, authoritatively,
// at conversion time) -- this only records that the code was present when
// checkout started.
export async function recordPendingAttribution(params: {
  userId: string;
  sourceProductType: string;
  sourceProductId: string;
  affiliateCode: string;
}): Promise<void> {
  const supabaseAdmin = await admin();
  await supabaseAdmin.from("affiliate_pending_attributions").insert({
    user_id: params.userId,
    source_product_type: params.sourceProductType,
    source_product_id: params.sourceProductId,
    affiliate_code: params.affiliateCode,
  });
}

// ---------- Conversion recording (the one path both callers use) ----------

type CreateConversionParams = {
  code: string;
  convertedUserId: string;
  sourceProductType: string;
  sourceProductId: string;
  appId: string | null;
  transactionRef: string;
  eligibleAmount: number;
  currency: string;
};

async function createConversionFromCode(
  params: CreateConversionParams,
): Promise<{ ok: boolean; reason?: string }> {
  const supabaseAdmin = await admin();

  if (!(await isGloballyEnabled(supabaseAdmin)))
    return { ok: false, reason: "affiliate_program_disabled" };

  const { data: link } = await supabaseAdmin
    .from("affiliate_links")
    .select("id, offer_id, affiliate_user_id, affiliate_offers(*)")
    .eq("code", params.code)
    .maybeSingle();
  if (!link) return { ok: false, reason: "invalid_code" };

  const offer = link.affiliate_offers as unknown as OfferRow | null;
  if (!offer) return { ok: false, reason: "offer_not_found" };
  if (
    offer.source_product_type !== params.sourceProductType ||
    offer.source_product_id !== params.sourceProductId
  ) {
    return { ok: false, reason: "offer_mismatch" };
  }
  if (!(await isOfferCurrentlyEligible(supabaseAdmin, offer)))
    return { ok: false, reason: "offer_not_eligible" };

  // Self-referral protection (spec section 25): the affiliate cannot earn
  // commission from their own purchase.
  if (link.affiliate_user_id === params.convertedUserId)
    return { ok: false, reason: "self_referral" };

  if ((await getAffiliateStatus(link.affiliate_user_id)) !== "active") {
    return { ok: false, reason: "affiliate_not_active" };
  }

  // Attribution: last valid click wins. `code` already encodes "the most
  // recently touched affiliate for this offer" (the client always
  // overwrites its stored code on a new click -- see the click redirect
  // route/affiliate-tracking client helper), so this only needs to verify
  // the MOST RECENT click for this specific link is still inside the
  // attribution window, not compare across affiliates.
  const { data: lastClick } = await supabaseAdmin
    .from("affiliate_clicks")
    .select("id, clicked_at")
    .eq("link_id", link.id)
    .order("clicked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastClick) return { ok: false, reason: "no_click_on_record" };

  const windowDays =
    offer.attribution_window_days ??
    Number((await getConfig(supabaseAdmin, "default_attribution_window_days")) ?? 30);
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  if (Date.now() - new Date(lastClick.clicked_at).getTime() > windowMs) {
    return { ok: false, reason: "outside_attribution_window" };
  }

  const returnPeriodDays =
    offer.return_period_days ??
    Number((await getConfig(supabaseAdmin, "default_return_period_days")) ?? 14);

  const commissionAmount =
    offer.commission_type === "percent"
      ? Math.round(params.eligibleAmount * (Number(offer.commission_rate) / 100) * 100) / 100
      : Number(offer.commission_fixed_amount);

  const { error } = await supabaseAdmin.from("affiliate_conversions").insert({
    affiliate_user_id: link.affiliate_user_id,
    offer_id: offer.id,
    link_id: link.id,
    click_id: lastClick.id,
    converted_user_id: params.convertedUserId,
    source_app_id: params.appId,
    transaction_ref: params.transactionRef,
    eligible_amount: params.eligibleAmount,
    currency: params.currency,
    commission_type: offer.commission_type,
    commission_rate: offer.commission_rate,
    commission_fixed_amount: offer.commission_fixed_amount,
    commission_amount: commissionAmount,
    return_period_days: returnPeriodDays,
  });
  if (error) {
    // Idempotency (spec section 26): the same transaction can only ever
    // produce one conversion -- a UNIQUE constraint on transaction_ref
    // enforces this at the database level, not just in application code.
    if (error.code === "23505") return { ok: false, reason: "duplicate_transaction" };
    console.error("createConversionFromCode: insert failed", error);
    return { ok: false, reason: "insert_failed" };
  }

  await sendNotification({
    userId: link.affiliate_user_id,
    appId: params.appId,
    category: "affiliate",
    type: "success",
    targetPath: "/dashboard/affiliate",
    dedupeKey: `affiliate-conversion:${params.transactionRef}`,
    content: {
      titleBs: "Nova konverzija zabilježena",
      titleEn: "New conversion recorded",
      titleDe: "Neue Conversion erfasst",
      messageBs: `Ostvario/la si proviziju od ${commissionAmount.toFixed(2)} ${params.currency}.`,
      messageEn: `You earned a commission of ${commissionAmount.toFixed(2)} ${params.currency}.`,
      messageDe: `Du hast eine Provision von ${commissionAmount.toFixed(2)} ${params.currency} verdient.`,
    },
  });

  // Activity/event integration (spec section 30) -- only meaningful when
  // there's a real application to attribute it to (recordEvent() requires
  // one, application_events is inherently per-application); a CORE-native
  // offer (Premium, Points Packages) has no application context to log
  // against, and the notification above already serves as that
  // conversion's observable activity signal. Never a reason to fail an
  // already-recorded, financially-authoritative conversion either way.
  const eventAppId = params.appId ?? offer.source_app_id;
  if (eventAppId) {
    const { recordEvent } = await import("@/lib/events.server");
    await recordEvent({
      appId: eventAppId,
      eventKey: "affiliate_conversion",
      actorUserId: link.affiliate_user_id,
      recipientUserId: link.affiliate_user_id,
      resourceType: "affiliate_conversion",
      resourceId: params.transactionRef,
      metadata: { commissionAmount, currency: params.currency },
      dedupeKey: null,
      origin: "application",
    }).catch((err: unknown) => {
      console.warn("createConversionFromCode: recordEvent failed (non-fatal)", err);
    });
  }

  return { ok: true };
}

// CORE-native purchases (Premium subscription, Points Package): resolves
// the affiliate code from the pending-attribution bridge (see
// recordPendingAttribution above) rather than accepting one directly --
// the webhook has no other way to know which code was active at checkout
// time. Never throws -- a failure here must never break payment
// fulfillment, matching processEngagement()'s established precedent.
export async function recordAffiliateConversionForCorePurchase(params: {
  userId: string;
  appId: string | null;
  sourceProductType: string;
  sourceProductId: string;
  paymentId: string;
  eligibleAmount: number;
  currency: string;
}): Promise<void> {
  try {
    const supabaseAdmin = await admin();
    const { data: pending } = await supabaseAdmin
      .from("affiliate_pending_attributions")
      .select("id, affiliate_code")
      .eq("user_id", params.userId)
      .eq("source_product_type", params.sourceProductType)
      .eq("source_product_id", params.sourceProductId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!pending) return;

    await createConversionFromCode({
      code: pending.affiliate_code,
      convertedUserId: params.userId,
      sourceProductType: params.sourceProductType,
      sourceProductId: params.sourceProductId,
      appId: params.appId,
      transactionRef: params.paymentId,
      eligibleAmount: params.eligibleAmount,
      currency: params.currency,
    });

    // Consumed either way (matched or not) -- a stale pending intent must
    // never attribute a later, unrelated purchase of the same product type.
    await supabaseAdmin.from("affiliate_pending_attributions").delete().eq("id", pending.id);
  } catch (err) {
    console.error("recordAffiliateConversionForCorePurchase failed (non-fatal)", err);
  }
}

// Application-reported purchases: the calling application supplies its own
// referral code directly (captured from the ?core_ref= query param on its
// own product page, per PROJECT_KNOWLEDGE.md -> Affiliate System) -- no
// pending-attribution bridge needed, since the application makes this call
// itself, synchronously with its own confirmed transaction.
export async function recordApplicationConversion(params: {
  code: string;
  convertedUserId: string;
  appId: string;
  sourceProductType: string;
  sourceProductId: string;
  transactionRef: string;
  eligibleAmount: number;
  currency: string;
}): Promise<{ ok: boolean; reason?: string }> {
  return createConversionFromCode({
    code: params.code,
    convertedUserId: params.convertedUserId,
    sourceProductType: params.sourceProductType,
    sourceProductId: params.sourceProductId,
    appId: params.appId,
    transactionRef: params.transactionRef,
    eligibleAmount: params.eligibleAmount,
    currency: params.currency,
  });
}

// ---------- Reversal (refund / return / chargeback) ----------

// Reverses whatever remains payable for a specific transaction (spec
// section 20). A not-yet-paid conversion is reversed in place -- nothing
// was ever paid out for it to misstate. An already-paid conversion is
// never mutated -- a new negative conversion row is created instead,
// preserving the original payout record exactly as it was, the same
// "append-only, a reversal is always a new row" convention
// reward_ledger's reversePaymentPoints() already established.
export async function reverseAffiliateConversion(
  transactionRef: string,
  reason: string,
): Promise<{ ok: boolean; reason?: string }> {
  const supabaseAdmin = await admin();
  const { data: conversion } = await supabaseAdmin
    .from("affiliate_conversions")
    .select("*")
    .eq("transaction_ref", transactionRef)
    .maybeSingle();
  if (!conversion) return { ok: false, reason: "conversion_not_found" };
  if (conversion.status === "reversed") return { ok: true };

  if (conversion.status === "pending" && !conversion.payout_id) {
    const { error } = await supabaseAdmin
      .from("affiliate_conversions")
      .update({
        status: "reversed",
        reversed_at: new Date().toISOString(),
        reversed_reason: reason,
      })
      .eq("id", conversion.id);
    if (error) return { ok: false, reason: "update_failed" };
    return { ok: true };
  }

  // Already batched into a payout (paid or pending payout) -- a new,
  // negative-amount conversion row records the clawback instead of
  // touching the original.
  const { error: insertErr } = await supabaseAdmin.from("affiliate_conversions").insert({
    affiliate_user_id: conversion.affiliate_user_id,
    offer_id: conversion.offer_id,
    link_id: conversion.link_id,
    click_id: conversion.click_id,
    converted_user_id: conversion.converted_user_id,
    source_app_id: conversion.source_app_id,
    transaction_ref: `${transactionRef}:reversal`,
    eligible_amount: conversion.eligible_amount,
    currency: conversion.currency,
    commission_type: conversion.commission_type,
    commission_rate: conversion.commission_rate,
    commission_fixed_amount: conversion.commission_fixed_amount,
    commission_amount: -conversion.commission_amount,
    return_period_days: conversion.return_period_days,
    status: "reversed",
    reversed_at: new Date().toISOString(),
    reversed_reason: reason,
    reversed_conversion_id: conversion.id,
  });
  if (insertErr) {
    if (insertErr.code === "23505") return { ok: true }; // already reversed (redelivery)
    console.error("reverseAffiliateConversion: reversal insert failed", insertErr);
    return { ok: false, reason: "insert_failed" };
  }
  return { ok: true };
}

// ---------- Payout batching (automatic *scheduling*; see header note) ----------

// Effective status is computed, never stored, for 'pending' conversions --
// the same "deterministic, time-based, no cron needed" philosophy this
// codebase already uses for entitlements/trials/campaigns/dashboard
// actions (see PROJECT_KNOWLEDGE.md -> Affiliate System). "Approved" only
// ever exists as this derived label, not a column value.
function isApproved(conversion: {
  status: string;
  created_at: string;
  return_period_days: number;
}): boolean {
  if (conversion.status !== "pending") return false;
  const dueAt =
    new Date(conversion.created_at).getTime() + conversion.return_period_days * 24 * 60 * 60 * 1000;
  return Date.now() >= dueAt;
}

// Aggregates every Affiliate's approved, not-yet-batched balance; creates
// one new 'pending' affiliate_payouts row per Affiliate whose balance
// meets the configured threshold, and links the included conversions to
// it. This is the automatic part (spec section 21's scheduling
// requirement) -- actually marking a payout 'paid' is a separate,
// currently manual Admin action (adminMarkAffiliatePayoutPaid,
// affiliate.functions.ts), since this codebase has no automated external
// payout provider integrated (spec section 23) -- documented here and in
// PROJECT_KNOWLEDGE.md, not silently implied as fully automated.
// Idempotent to run repeatedly: a conversion already linked to a payout
// (payout_id IS NOT NULL) is never included again.
export async function runAffiliatePayoutSweep(): Promise<{
  payoutsCreated: number;
  totalAmount: number;
}> {
  const supabaseAdmin = await admin();
  const threshold = Number((await getConfig(supabaseAdmin, "payout_threshold_eur")) ?? 50);

  const { data: candidates } = await supabaseAdmin
    .from("affiliate_conversions")
    .select(
      "id, affiliate_user_id, commission_amount, currency, status, created_at, return_period_days",
    )
    .eq("status", "pending")
    .is("payout_id", null);

  const byAffiliate = new Map<string, { ids: string[]; amount: number; currency: string }>();
  for (const c of candidates ?? []) {
    if (!isApproved(c)) continue;
    const existing = byAffiliate.get(c.affiliate_user_id) ?? {
      ids: [],
      amount: 0,
      currency: c.currency,
    };
    existing.ids.push(c.id);
    existing.amount += Number(c.commission_amount);
    byAffiliate.set(c.affiliate_user_id, existing);
  }

  let payoutsCreated = 0;
  let totalAmount = 0;
  for (const [affiliateUserId, group] of byAffiliate) {
    if (group.amount < threshold) continue; // below threshold -- carries forward automatically (spec section 22)
    if ((await getAffiliateStatus(affiliateUserId)) !== "active") continue; // suspended/disabled: no new payout

    const { data: payout, error } = await supabaseAdmin
      .from("affiliate_payouts")
      .insert({
        affiliate_user_id: affiliateUserId,
        amount: group.amount,
        currency: group.currency,
      })
      .select("id")
      .single();
    if (error || !payout) {
      console.error("runAffiliatePayoutSweep: payout insert failed", error);
      continue;
    }
    await supabaseAdmin
      .from("affiliate_conversions")
      .update({ payout_id: payout.id })
      .in("id", group.ids);
    await sendNotification({
      userId: affiliateUserId,
      category: "affiliate",
      type: "success",
      targetPath: "/dashboard/affiliate",
      dedupeKey: `affiliate-payout-scheduled:${payout.id}`,
      content: {
        titleBs: "Isplata je zakazana",
        titleEn: "Payout scheduled",
        titleDe: "Auszahlung geplant",
        messageBs: `${group.amount.toFixed(2)} ${group.currency} je spremno za isplatu.`,
        messageEn: `${group.amount.toFixed(2)} ${group.currency} is ready for payout.`,
        messageDe: `${group.amount.toFixed(2)} ${group.currency} ist zur Auszahlung bereit.`,
      },
    });
    payoutsCreated += 1;
    totalAmount += group.amount;
  }

  return { payoutsCreated, totalAmount };
}

export { isApproved as isConversionApproved };
