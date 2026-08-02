// Priority 8.4: Advertising -- core business logic.
//
// Plain server-only helpers (matching the admin.server.ts/rewards.server.ts
// split), since several of these are called directly from the Stripe/PayPal
// webhooks, not only from advertising.functions.ts.
import { hasAnyActivePremium } from "@/lib/premium";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type ModerationMode = "manual" | "auto" | "trusted_only";
type EligibilityRule = "anyone" | "premium_only" | "verified_only" | "trusted_only";

async function resolveGlobalAdConfig(configKey: string, fallback: string): Promise<string> {
  const supabaseAdmin = await admin();
  const { data: globalConfig } = await supabaseAdmin
    .from("ad_config")
    .select("value")
    .eq("key", configKey)
    .maybeSingle();
  const value = globalConfig?.value;
  return typeof value === "string" ? value : fallback;
}

// Per-application override wins; falls back to the global ad_config
// default; falls back to a hardcoded last resort only if neither row
// exists at all (should never happen post-migration, since both keys are
// seeded).
export async function resolveModerationMode(appId: string): Promise<ModerationMode> {
  const supabaseAdmin = await admin();
  const { data: appSetting } = await supabaseAdmin
    .from("ad_application_settings")
    .select("moderation_mode")
    .eq("app_id", appId)
    .maybeSingle();
  if (appSetting?.moderation_mode) return appSetting.moderation_mode as ModerationMode;
  return (await resolveGlobalAdConfig("moderation_mode", "manual")) as ModerationMode;
}

export async function resolveEligibilityRule(appId: string): Promise<EligibilityRule> {
  const supabaseAdmin = await admin();
  const { data: appSetting } = await supabaseAdmin
    .from("ad_application_settings")
    .select("eligibility_rule")
    .eq("app_id", appId)
    .maybeSingle();
  if (appSetting?.eligibility_rule) return appSetting.eligibility_rule as EligibilityRule;
  return (await resolveGlobalAdConfig("eligibility_rule", "anyone")) as EligibilityRule;
}

// Application-specific, not global: trust granted for one application says
// nothing about any other. See PROJECT_KNOWLEDGE.md -> Advertising.
export async function isTrustedAdvertiser(userId: string, appId: string): Promise<boolean> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("ad_trusted_advertisers")
    .select("user_id")
    .eq("user_id", userId)
    .eq("app_id", appId)
    .maybeSingle();
  return !!data;
}

// Single centralized eligibility resolver -- no per-call-site branching on
// what a rule means. 'business_accounts_only' is a known future vocabulary
// gap: CORE has no "business account" concept yet, so it is deliberately
// not offered as a selectable value at the database CHECK constraint level
// (see the Advertising migration) rather than silently treated as "anyone."
export async function checkAdvertiserEligibility(
  userId: string,
  appId: string,
): Promise<{ eligible: boolean; rule: EligibilityRule }> {
  const rule = await resolveEligibilityRule(appId);
  switch (rule) {
    case "anyone":
      return { eligible: true, rule };
    case "premium_only":
      return { eligible: await hasAnyActivePremium(userId), rule };
    case "verified_only": {
      const supabaseAdmin = await admin();
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("is_verified")
        .eq("id", userId)
        .maybeSingle();
      return { eligible: !!data?.is_verified, rule };
    }
    case "trusted_only":
      return { eligible: await isTrustedAdvertiser(userId, appId), rule };
    default:
      return { eligible: false, rule };
  }
}

// Auto-approval status for a newly purchased campaign -- resolved once,
// at the same moderation_mode this application currently has configured.
// A later admin change to moderation_mode never retroactively changes
// campaigns already created.
export async function resolveInitialCampaignStatus(
  userId: string,
  appId: string,
): Promise<"pending" | "active"> {
  const mode = await resolveModerationMode(appId);
  if (mode === "auto") return "active";
  if (mode === "trusted_only") return (await isTrustedAdvertiser(userId, appId)) ? "active" : "pending";
  return "pending";
}

export type ResolvedPlacementPrice = {
  id: string;
  placementKey: string;
  durationDays: number;
  price: number;
  currency: string;
  pricingStrategy: string;
  stripePaymentLink: string | null;
  paypalPaymentLink: string | null;
};

// Global (app_id IS NULL) or per-application price rows -- when both a
// global and an app-specific row exist for the same duration_days, the
// app-specific one wins.
export async function resolvePlacementPrices(
  appId: string,
  placementKey: string,
): Promise<ResolvedPlacementPrice[]> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("ad_placement_prices")
    .select("*")
    .eq("placement_key", placementKey)
    .eq("enabled", true)
    .eq("archived", false)
    .or(`app_id.eq.${appId},app_id.is.null`)
    .order("display_order", { ascending: true });

  const byDuration = new Map<number, NonNullable<typeof data>[number]>();
  for (const row of data ?? []) {
    const existing = byDuration.get(row.duration_days);
    // App-specific rows (app_id set) win over a global row for the same
    // duration -- process global rows first, then let app-specific rows
    // overwrite.
    if (!existing || row.app_id === appId) byDuration.set(row.duration_days, row);
  }

  return Array.from(byDuration.values()).map((row) => ({
    id: row.id,
    placementKey: row.placement_key,
    durationDays: row.duration_days,
    price: Number(row.price),
    currency: row.currency,
    pricingStrategy: row.pricing_strategy,
    stripePaymentLink: row.stripe_payment_link,
    paypalPaymentLink: row.paypal_payment_link,
  }));
}

export async function resolvePlacementPriceById(
  placementPriceId: string,
): Promise<ResolvedPlacementPrice | null> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("ad_placement_prices")
    .select("*")
    .eq("id", placementPriceId)
    .eq("enabled", true)
    .eq("archived", false)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    placementKey: data.placement_key,
    durationDays: data.duration_days,
    price: Number(data.price),
    currency: data.currency,
    pricingStrategy: data.pricing_strategy,
    stripePaymentLink: data.stripe_payment_link,
    paypalPaymentLink: data.paypal_payment_link,
  };
}

// Available advertising-account credit balance -- a signed-amount,
// append-only ledger (mirrors reward_ledger's shape, but here rows can be
// negative: positive = a fulfilled Rewards redemption, negative = credit
// consumed as a checkout discount). Single-currency assumption (EUR):
// this codebase has no multi-currency reconciliation anywhere yet, so
// mixing currencies within one user's balance is a known, unaddressed gap
// carried over from the rest of the payment system.
export async function getAdAccountCreditBalance(userId: string): Promise<number> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin.from("ad_account_credits").select("amount").eq("user_id", userId);
  return (data ?? []).reduce((sum, r) => sum + Number(r.amount), 0);
}

// Called only from the Stripe/PayPal webhooks once payment is confirmed.
// Re-derives the expected price and available credit fully server-side
// (never trusts anything about a discount from the client or the signed
// reference) -- the signed reference only ever carries (user, app,
// campaign_id). The campaign row itself (with its creative content) was
// already created as 'draft' by createDraftCampaign before checkout; this
// activates that same row rather than creating a new one, which is what
// lets a static Stripe/PayPal Payment Link (no metadata channel for
// title/image/link) still work for campaign checkout.
export async function activateCampaignFromPurchase(params: {
  campaignId: string;
  userId: string;
  appId: string;
  paidAmount: number;
  paidCurrency: string;
}): Promise<{ ok: true; creditApplied: number } | { ok: false; reason: string }> {
  const supabaseAdmin = await admin();

  const { data: campaign } = await supabaseAdmin
    .from("ad_campaigns")
    .select("*")
    .eq("id", params.campaignId)
    .maybeSingle();
  if (!campaign || campaign.user_id !== params.userId || campaign.app_id !== params.appId) {
    return { ok: false, reason: "campaign_not_found" };
  }
  if (campaign.status !== "draft") {
    // Already activated by an earlier delivery of the same webhook event.
    return { ok: false, reason: "already_processed" };
  }
  if (!campaign.placement_price_id) return { ok: false, reason: "no_price_reference" };

  const price = await resolvePlacementPriceById(campaign.placement_price_id);
  if (!price) return { ok: false, reason: "price_not_found" };

  const creditBalance = await getAdAccountCreditBalance(params.userId);
  const creditApplied = Math.min(creditBalance, price.price);
  const expectedAmount = Math.max(0, price.price - creditApplied);

  const amountMatches = Math.abs(params.paidAmount - expectedAmount) < 0.01;
  const currencyMatches = params.paidCurrency.toUpperCase() === price.currency.toUpperCase();
  if (!amountMatches || !currencyMatches) {
    return { ok: false, reason: "amount_mismatch" };
  }

  const status = await resolveInitialCampaignStatus(params.userId, params.appId);
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + price.durationDays * 24 * 60 * 60 * 1000);

  const { error: updateErr } = await supabaseAdmin
    .from("ad_campaigns")
    .update({
      status,
      starts_at: startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaign.id)
    .eq("status", "draft"); // idempotency guard against a concurrent redelivery
  if (updateErr) {
    console.error("activateCampaignFromPurchase: campaign update failed", updateErr);
    return { ok: false, reason: "update_failed" };
  }

  if (creditApplied > 0) {
    const { error: debitErr } = await supabaseAdmin.from("ad_account_credits").insert({
      user_id: params.userId,
      amount: -creditApplied,
      currency: price.currency,
      source: "campaign_purchase",
      source_id: campaign.id,
    });
    if (debitErr) console.error("activateCampaignFromPurchase: credit debit failed", debitErr);
  }

  return { ok: true, creditApplied };
}

// Lazy cleanup, not a scheduled job -- this codebase has no cron
// infrastructure (same reasoning as Rewards & Loyalty's referral-
// verification promotion). Called from getMyCampaigns, so a user's own
// abandoned drafts are cleared the next time they look at their campaigns.
// Cancels rather than deletes -- never a hard delete of a record that may
// be referenced elsewhere (audit_logs, a future admin report).
export async function expireStaleDraftCampaigns(userId: string): Promise<void> {
  const supabaseAdmin = await admin();
  const { data: config } = await supabaseAdmin
    .from("ad_config")
    .select("value")
    .eq("key", "draft_expiry_hours")
    .maybeSingle();
  const expiryHours = typeof config?.value === "number" ? config.value : 48;
  const cutoff = new Date(Date.now() - expiryHours * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseAdmin
    .from("ad_campaigns")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "draft")
    .lt("created_at", cutoff);
  if (error) console.error("expireStaleDraftCampaigns: update failed", error);
}

// Public ad-serving: the currently active campaign for a placement, if
// any. Deliberately returns only the fields needed to render a creative --
// never the owner, moderation history, or pricing.
export async function getActivePlacementCreative(
  appId: string,
  placementKey: string,
): Promise<{ campaignId: string; title: string; imageUrl: string | null; linkUrl: string | null } | null> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("ad_campaigns")
    .select("id, title, image_url, link_url")
    .eq("app_id", appId)
    .eq("placement_key", placementKey)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { campaignId: data.id, title: data.title, imageUrl: data.image_url, linkUrl: data.link_url };
}
