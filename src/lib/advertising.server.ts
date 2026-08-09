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
  if (mode === "trusted_only")
    return (await isTrustedAdvertiser(userId, appId)) ? "active" : "pending";
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
  const { data } = await supabaseAdmin
    .from("ad_account_credits")
    .select("amount")
    .eq("user_id", userId);
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

// ---------- Priority 13, Phase D1: Placement & Delivery Foundation ----------
// Placement (WHERE on a page) composes with Channel/Target (WHICH
// destination, Phase C/D) without merging either concept. ad_placements
// stays the global "does this position exist" registry; ad_application_
// placements is "is it live, purchasable, and how, for THIS application" --
// same division of responsibility as ad_channels/ad_channel_apps.

export type ResolvedApplicationPlacement = {
  appId: string;
  placementKey: string;
  enabled: boolean;
  purchasable: boolean;
  allowedFormatKeys: string[];
  supportedDevices: string[];
  lastDeliveryAt: string | null;
};

// The one place "is this placement deliverable for this application"
// is decided. purchasable is deliberately NOT part of the delivery
// decision -- it governs new sales only (see getActivePlacementCreative's
// own gate below, which checks .enabled, never .purchasable). Requires
// BOTH the global ad_placements row (enabled, non-archived) and a
// per-application ad_application_placements row to exist -- a placement
// with no mapping row for this app is treated as not configured, not as
// "open to everyone."
export async function resolveApplicationPlacement(
  appId: string,
  placementKey: string,
): Promise<ResolvedApplicationPlacement | null> {
  const supabaseAdmin = await admin();

  const { data: placement } = await supabaseAdmin
    .from("ad_placements")
    .select("enabled, archived")
    .eq("key", placementKey)
    .maybeSingle();
  if (!placement || !placement.enabled || placement.archived) return null;

  const { data: mapping } = await supabaseAdmin
    .from("ad_application_placements")
    .select("*")
    .eq("app_id", appId)
    .eq("placement_key", placementKey)
    .maybeSingle();
  if (!mapping) return null;

  return {
    appId,
    placementKey,
    enabled: mapping.enabled,
    purchasable: mapping.purchasable,
    allowedFormatKeys: mapping.allowed_format_keys,
    supportedDevices: mapping.supported_devices,
    lastDeliveryAt: mapping.last_delivery_at,
  };
}

// Best-effort, non-blocking. This is the only CORE-verifiable "integration"
// signal -- CORE cannot inspect another application's codebase, it can only
// record that its own delivery endpoint was actually called for this
// (app, placement). Never awaited by a caller in a way that could make a
// delivery response depend on this write succeeding.
async function touchPlacementDelivery(appId: string, placementKey: string): Promise<void> {
  try {
    const supabaseAdmin = await admin();
    await supabaseAdmin
      .from("ad_application_placements")
      .update({ last_delivery_at: new Date().toISOString() })
      .eq("app_id", appId)
      .eq("placement_key", placementKey);
  } catch (err) {
    console.error("touchPlacementDelivery: update failed", err);
  }
}

export type AdDevice = "desktop" | "mobile";

type PlacementCreative = {
  campaignId: string;
  title: string;
  imageUrl: string | null;
  linkUrl: string | null;
};

// Public ad-serving: the currently eligible creative for a placement, if
// any. Deliberately returns only the fields needed to render a creative --
// never the owner, moderation history, or pricing. Considers two sources --
// the legacy single-placement campaign (unchanged filter/order/limit from
// before Phase D1) and Phase D campaign targets (new) -- and picks whichever
// is more recent, exactly the same recency rule already used, never a new
// ranking/weighting scheme.
export async function getActivePlacementCreative(
  appId: string,
  placementKey: string,
  device?: AdDevice,
): Promise<PlacementCreative | null> {
  const supabaseAdmin = await admin();

  const mapping = await resolveApplicationPlacement(appId, placementKey);
  if (mapping) void touchPlacementDelivery(appId, placementKey);
  if (!mapping || !mapping.enabled) return null;
  if (device && !mapping.supportedDevices.includes(device)) return null;

  // Legacy branch -- same WHERE/ORDER/LIMIT as before Phase D1; only
  // addition is selecting created_at, needed below to compare recency
  // against a target candidate. Never changes which campaign is matched.
  const { data: campaignRow } = await supabaseAdmin
    .from("ad_campaigns")
    .select("id, title, image_url, link_url, created_at")
    .eq("app_id", appId)
    .eq("placement_key", placementKey)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Target branch -- eligible when the target itself is 'active', its own
  // dates are current, it names this exact placement, and its destination
  // channel both represents this application and is itself still
  // enabled+non-archived (a disabled/archived channel can never deliver,
  // regardless of target status). Channel/date checks run in application
  // code rather than as embedded-relation filters, since this environment
  // has no live Supabase connection to verify PostgREST embedded-filter
  // syntax against.
  const { data: targetRows } = await supabaseAdmin
    .from("ad_campaign_targets")
    .select(
      "id, status, starts_at, expires_at, created_at, ad_campaigns(id, title, image_url, link_url), ad_channels(represents_app_id, enabled, archived)",
    )
    .eq("placement_key", placementKey)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);

  const now = Date.now();
  const eligibleTarget = (targetRows ?? []).find((t) => {
    const channel = t.ad_channels as unknown as {
      represents_app_id: string | null;
      enabled: boolean;
      archived: boolean;
    } | null;
    if (!channel || channel.represents_app_id !== appId || !channel.enabled || channel.archived)
      return false;
    if (t.starts_at && new Date(t.starts_at).getTime() > now) return false;
    if (t.expires_at && new Date(t.expires_at).getTime() <= now) return false;
    return true;
  });

  type Candidate = PlacementCreative & { createdAt: string };
  const candidates: Candidate[] = [];
  if (campaignRow) {
    candidates.push({
      campaignId: campaignRow.id,
      title: campaignRow.title,
      imageUrl: campaignRow.image_url,
      linkUrl: campaignRow.link_url,
      createdAt: campaignRow.created_at,
    });
  }
  if (eligibleTarget) {
    const c = eligibleTarget.ad_campaigns as unknown as {
      id: string;
      title: string;
      image_url: string | null;
      link_url: string | null;
    } | null;
    // A target with no creative to inherit from its parent campaign (should
    // never happen -- campaign_id is NOT NULL -- but defensively skipped).
    if (c) {
      candidates.push({
        campaignId: c.id,
        title: c.title,
        imageUrl: c.image_url,
        linkUrl: c.link_url,
        createdAt: eligibleTarget.created_at,
      });
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const { campaignId, title, imageUrl, linkUrl } = candidates[0];
  return { campaignId, title, imageUrl, linkUrl };
}

// ---------- Priority 13, Phase D: campaign target selection ----------
// Additional distribution channels layered onto an existing campaign.
// Pricing resolution mirrors resolvePlacementPrices/resolvePlacementPriceById
// above exactly -- the client only ever sends a channelPriceId; the actual
// price is always looked up here, never trusted from the caller.

export type ResolvedChannelPrice = {
  id: string;
  channelId: string;
  durationDays: number;
  price: number;
  currency: string;
  pricingStrategy: string;
};

export async function resolveChannelPrices(channelId: string): Promise<ResolvedChannelPrice[]> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("ad_channel_prices")
    .select("*")
    .eq("channel_id", channelId)
    .eq("enabled", true)
    .eq("archived", false)
    .order("display_order", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id,
    channelId: row.channel_id,
    durationDays: row.duration_days,
    price: Number(row.price),
    currency: row.currency,
    pricingStrategy: row.pricing_strategy,
  }));
}

export async function resolveChannelPriceById(
  channelPriceId: string,
): Promise<ResolvedChannelPrice | null> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("ad_channel_prices")
    .select("*")
    .eq("id", channelPriceId)
    .eq("enabled", true)
    .eq("archived", false)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    channelId: data.channel_id,
    durationDays: data.duration_days,
    price: Number(data.price),
    currency: data.currency,
    pricingStrategy: data.pricing_strategy,
  };
}

export type AvailableAdChannel = {
  id: string;
  key: string;
  name: string;
  channelTypeKey: string;
  description: string | null;
  logoUrl: string | null;
  externalUrl: string | null;
  representsAppId: string | null;
  prices: ResolvedChannelPrice[];
};

// A channel is offered for an application if it has no ad_channel_apps rows
// at all (unscoped -- offered under every application, e.g. a global
// external website) or is explicitly associated with that application (e.g.
// a per-application social account). Only enabled+purchasable+non-archived
// channels that resolve at least one enabled price are ever returned -- an
// unavailable/inactive channel is filtered out here, at the single place
// every selection surface reads from, not left to client-side filtering.
export async function getAvailableChannelsForApp(appId: string): Promise<AvailableAdChannel[]> {
  const supabaseAdmin = await admin();
  const { data: channels } = await supabaseAdmin
    .from("ad_channels")
    .select("*, ad_channel_apps(app_id)")
    .eq("enabled", true)
    .eq("purchasable", true)
    .eq("archived", false)
    .order("display_order", { ascending: true });

  const inScope = (channels ?? []).filter((c) => {
    const associations = (c.ad_channel_apps ?? []) as { app_id: string }[];
    return associations.length === 0 || associations.some((a) => a.app_id === appId);
  });

  const results = await Promise.all(
    inScope.map(async (c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      channelTypeKey: c.channel_type_key,
      description: c.description,
      logoUrl: c.logo_url,
      externalUrl: c.external_url,
      representsAppId: c.represents_app_id,
      prices: await resolveChannelPrices(c.id),
    })),
  );
  return results.filter((c) => c.prices.length > 0);
}

export type AvailableApplicationPlacement = {
  key: string;
  label: string;
  description: string | null;
};

// Placements a customer may pick for a target whose channel represents this
// application -- enabled+purchasable at both the global ad_placements level
// and the per-application ad_application_placements level. Not every
// application has any (the mapping is admin-configured, additive), which is
// exactly why placement selection stays optional in the target-selection UI.
export async function getAvailableApplicationPlacements(
  appId: string,
): Promise<AvailableApplicationPlacement[]> {
  const supabaseAdmin = await admin();
  // Filtered in application code rather than via embedded-relation filter
  // syntax, matching getActivePlacementCreative's same reasoning above --
  // this environment has no live Supabase connection to verify
  // PostgREST's dot-path embedded filters against.
  const { data } = await supabaseAdmin
    .from("ad_application_placements")
    .select("placement_key, ad_placements(key, label, enabled, archived)")
    .eq("app_id", appId)
    .eq("enabled", true)
    .eq("purchasable", true);

  return (data ?? [])
    .map(
      (row) =>
        row.ad_placements as unknown as {
          key: string;
          label: string;
          enabled: boolean;
          archived: boolean;
        } | null,
    )
    .filter(
      (p): p is { key: string; label: string; enabled: boolean; archived: boolean } =>
        !!p && p.enabled && !p.archived,
    )
    .map((p) => ({ key: p.key, label: p.label, description: null }));
}
