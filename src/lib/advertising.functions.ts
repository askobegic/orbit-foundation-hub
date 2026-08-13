// Priority 8.4: Advertising -- public server-function surface.
//
// Business logic lives in advertising.server.ts; this file is the
// createServerFn-wrapped API. See PROJECT_KNOWLEDGE.md -> Advertising.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import {
  checkAdvertiserEligibility,
  expireStaleDraftCampaigns,
  getAdAccountCreditBalance,
  getActivePlacementCreative,
  getAvailableApplicationPlacements,
  getAvailableChannelsForApp,
  resolveChannelPriceById,
  resolveInitialCampaignStatus,
  resolvePlacementPriceById,
  resolvePlacementPrices,
} from "@/lib/advertising.server";
import type { AdDevice } from "@/lib/advertising.server";
import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { isSafeProfileUrl } from "@/lib/url";
import { signCampaignReference } from "@/lib/payment-reference.server";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// ---------- Public: browsing + ad serving ----------

const placementsForAppSchema = z.object({ appId: z.string().uuid() });

// Placements + resolved prices available for one application -- empty if
// the 'advertising' capability is disabled for that application (the same
// dependency-validation rule as every other capability-gated surface: the
// capability being off must disable the entire feature, including the
// ability to even see placements to buy).
export const getAdPlacementsForApp = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => placementsForAppSchema.parse(raw))
  .handler(async ({ data }) => {
    const capabilities = await getApplicationCapabilities({ data: { appId: data.appId } });
    if (!capabilities.includes("advertising")) return [];

    const supabase = await adminClient();
    const { data: placements } = await supabase
      .from("ad_placements")
      .select("*")
      .eq("enabled", true)
      .eq("archived", false)
      .order("display_order", { ascending: true });

    const results = await Promise.all(
      (placements ?? []).map(async (p) => ({
        key: p.key,
        label: p.label,
        description: p.description,
        prices: await resolvePlacementPrices(data.appId, p.key),
      })),
    );
    return results.filter((p) => p.prices.length > 0);
  });

const activeAdSchema = z.object({
  appId: z.string().uuid(),
  placementKey: z.string(),
  device: z.enum(["desktop", "mobile"]).optional(),
});

// device is optional -- omitted entirely, existing callers get the exact
// same unfiltered behavior as before Phase D1 (see getActivePlacementCreative,
// which only applies the device check when a device is actually supplied).
export const getActivePlacementAd = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => activeAdSchema.parse(raw))
  .handler(async ({ data }) => {
    const capabilities = await getApplicationCapabilities({ data: { appId: data.appId } });
    if (!capabilities.includes("advertising")) return null;
    return getActivePlacementCreative(
      data.appId,
      data.placementKey,
      data.device as AdDevice | undefined,
    );
  });

// ---------- Authenticated: self-serve campaign creation ----------

const summarySchema = z.object({ appId: z.string().uuid() });

// What the checkout UI needs before the user commits: are they eligible,
// and how much advertising credit do they currently have available.
export const getMyAdvertisingSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => summarySchema.parse(raw))
  .handler(async ({ data, context }) => {
    const [{ eligible, rule }, creditBalance] = await Promise.all([
      checkAdvertiserEligibility(context.userId, data.appId),
      getAdAccountCreditBalance(context.userId),
    ]);
    return { eligible, eligibilityRule: rule, creditBalance };
  });

const createDraftSchema = z.object({
  appId: z.string().uuid(),
  placementPriceId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  imageUrl: z.string().trim().nullable().optional(),
  linkUrl: z.string().trim().nullable().optional(),
});

// A campaign is created as 'draft' *before* checkout and only activated
// by the webhook on payment success (see payment-reference.server.ts for
// why -- static Stripe/PayPal Payment Links have no channel to carry
// creative content through the payment provider). A draft with no
// completed payment simply never leaves 'draft' and is never served or
// shown to anyone but its owner.
export const createDraftCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => createDraftSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const capabilities = await getApplicationCapabilities({ data: { appId: data.appId } });
    if (!capabilities.includes("advertising"))
      throw new Error("Advertising is not available for this application");

    const { eligible } = await checkAdvertiserEligibility(context.userId, data.appId);
    if (!eligible)
      throw new Error("You are not eligible to create a campaign for this application");

    const price = await resolvePlacementPriceById(data.placementPriceId);
    if (
      !price ||
      (await resolvePlacementPrices(data.appId, price.placementKey)).every((p) => p.id !== price.id)
    ) {
      throw new Error("Invalid placement price for this application");
    }

    if (data.linkUrl && !isSafeProfileUrl(data.linkUrl)) throw new Error("Invalid link URL");
    if (data.imageUrl && !isSafeProfileUrl(data.imageUrl)) throw new Error("Invalid image URL");

    // service_role, not context.supabase: ad_campaigns only grants
    // authenticated SELECT (see the Advertising migration) -- every write
    // goes through a server-validated path like this one (capability,
    // eligibility, and price already checked above), never a direct
    // client-authenticated insert.
    const supabaseAdmin = await adminClient();
    const { data: row, error } = await supabaseAdmin
      .from("ad_campaigns")
      .insert({
        user_id: context.userId,
        app_id: data.appId,
        placement_key: price.placementKey,
        placement_price_id: price.id,
        title: data.title,
        image_url: data.imageUrl ?? null,
        link_url: data.linkUrl ?? null,
        status: "draft",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const createReferenceSchema = z.object({ campaignId: z.string().uuid() });

// Informational price/credit figures returned here are for checkout-page
// display only -- never trusted at fulfillment time. The webhook
// re-derives both fully server-side (see activateCampaignFromPurchase).
export const createCampaignCheckoutReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => createReferenceSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: campaign } = await context.supabase
      .from("ad_campaigns")
      .select("*")
      .eq("id", data.campaignId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!campaign) throw new Error("Campaign not found");
    if (campaign.status !== "draft") throw new Error("Campaign is not awaiting payment");
    if (!campaign.placement_price_id) throw new Error("Campaign has no price reference");

    const price = await resolvePlacementPriceById(campaign.placement_price_id);
    if (!price) throw new Error("Invalid placement price");

    const creditBalance = await getAdAccountCreditBalance(context.userId);
    const creditApplied = Math.min(creditBalance, price.price);
    const expectedAmount = Math.max(0, price.price - creditApplied);

    return {
      reference: signCampaignReference(context.userId, campaign.app_id, campaign.id),
      expectedAmount,
      currency: price.currency,
      creditApplied,
      stripePaymentLink: price.stripePaymentLink,
      paypalPaymentLink: price.paypalPaymentLink,
    };
  });

const updateCreativeSchema = z.object({
  campaignId: z.string().uuid(),
  title: z.string().trim().min(1).max(120).optional(),
  imageUrl: z.string().trim().nullable().optional(),
  linkUrl: z.string().trim().nullable().optional(),
});

// Editing creative/destination after a campaign has already been approved
// (status 'active') -- or while it's 'pending'/'rejected' -- re-runs the
// exact same resolver used at purchase-activation time
// (resolveInitialCampaignStatus), so an edited campaign never bypasses
// moderation: if the application currently requires manual review, the
// edit demotes the campaign back to 'pending' for re-review; if moderation
// is effectively off (auto, or the buyer is trusted under trusted_only),
// it stays/returns to 'active' with no manual step. A 'draft' campaign
// (not yet paid) is simply updated in place -- there is no moderation
// state to preserve yet. 'ended'/'cancelled' campaigns can no longer be
// edited.
export const updateCampaignCreative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => updateCreativeSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: campaign } = await context.supabase
      .from("ad_campaigns")
      .select("*")
      .eq("id", data.campaignId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!campaign) throw new Error("Campaign not found");
    if (campaign.status === "ended" || campaign.status === "cancelled") {
      throw new Error("This campaign can no longer be edited");
    }

    if (data.linkUrl && !isSafeProfileUrl(data.linkUrl)) throw new Error("Invalid link URL");
    if (data.imageUrl && !isSafeProfileUrl(data.imageUrl)) throw new Error("Invalid image URL");

    const patch: {
      title: string;
      image_url: string | null;
      link_url: string | null;
      updated_at: string;
      status?: "pending" | "active";
      moderation_note?: null;
    } = {
      title: data.title ?? campaign.title,
      image_url: data.imageUrl !== undefined ? data.imageUrl : campaign.image_url,
      link_url: data.linkUrl !== undefined ? data.linkUrl : campaign.link_url,
      updated_at: new Date().toISOString(),
    };
    if (campaign.status !== "draft") {
      patch.status = await resolveInitialCampaignStatus(context.userId, campaign.app_id);
      patch.moderation_note = null;
    }

    // service_role: campaign status is never authenticated-writable
    // directly (see the ad_campaigns RLS/grants) -- only this
    // server-resolved value is ever written for it.
    const supabaseAdmin = await adminClient();
    const { data: row, error } = await supabaseAdmin
      .from("ad_campaigns")
      .update(patch)
      .eq("id", campaign.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "ad_campaign.update_creative",
      entityType: "ad_campaign",
      entityId: row.id,
      oldData: campaign,
      newData: row,
    });
    return row;
  });

export const getMyCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await expireStaleDraftCampaigns(context.userId);
    const { data, error } = await context.supabase
      .from("ad_campaigns")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- Authenticated: campaign target selection (Priority 13, Phase D) ----------
//
// Purely additive extra distribution channels layered onto an existing
// campaign (see getMyCampaigns above for the campaign itself, unchanged).
// No checkout/payment here yet -- targets are created/removed in 'draft'
// status only; Phase F wires up per-target checkout the same way
// createCampaignCheckoutReference/activateCampaignFromPurchase already do
// for the campaign-level purchase above.

const campaignChannelsSchema = z.object({ campaignId: z.string().uuid() });

// Channels available for this campaign's application, each already carrying
// its resolved, enabled price list -- same shape as getAdPlacementsForApp
// above, so the UI never guesses at or invents a price.
export const getAvailableAdChannelsForCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => campaignChannelsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: campaign } = await context.supabase
      .from("ad_campaigns")
      .select("id, app_id")
      .eq("id", data.campaignId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!campaign) throw new Error("Campaign not found");
    return getAvailableChannelsForApp(campaign.app_id);
  });

// Placements the customer may pick when a selected channel represents a
// CORE application (channel.representsAppId) -- used by the target-
// selection UI to offer an optional placement per destination. Empty list
// is a valid, expected answer (not every application has any configured
// placements); the target-selection UI must remain fully usable without one.
export const getAvailablePlacementsForApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ appId: z.string().uuid() }).parse(raw))
  .handler(async ({ data }) => getAvailableApplicationPlacements(data.appId));

export const getMyCampaignTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => campaignChannelsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: campaign } = await context.supabase
      .from("ad_campaigns")
      .select("id")
      .eq("id", data.campaignId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!campaign) throw new Error("Campaign not found");

    const { data: rows, error } = await context.supabase
      .from("ad_campaign_targets")
      .select("*")
      .eq("campaign_id", data.campaignId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const addTargetSchema = z.object({
  campaignId: z.string().uuid(),
  channelPriceId: z.string().uuid(),
  placementKey: z.string().trim().min(1).nullable().optional(),
});

// The client only ever sends a channelPriceId -- the price itself is always
// resolved server-side (resolveChannelPriceById) and re-validated against
// the campaign's own application scope (getAvailableChannelsForApp), so a
// disabled/unavailable/unrelated channel can never be added regardless of
// what the client requests. placementKey (Phase D1) is optional -- a
// social-media-channel target legitimately has no page position; when
// provided, it's checked to be a real ad_placements key, nothing more --
// which channel types "should" carry a placement is left as a UI/product
// decision, not a hard server-side restriction.
export const addCampaignTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => addTargetSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: campaign } = await context.supabase
      .from("ad_campaigns")
      .select("id, app_id, status")
      .eq("id", data.campaignId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!campaign) throw new Error("Campaign not found");
    if (["ended", "cancelled", "rejected"].includes(campaign.status)) {
      throw new Error("This campaign can no longer be edited");
    }

    const price = await resolveChannelPriceById(data.channelPriceId);
    if (!price) throw new Error("Invalid channel price");

    const available = await getAvailableChannelsForApp(campaign.app_id);
    const isAvailable = available.some((c) => c.prices.some((p) => p.id === price.id));
    if (!isAvailable) throw new Error("This channel is not available for this campaign");

    const supabaseAdmin = await adminClient();

    if (data.placementKey) {
      const { data: placement } = await supabaseAdmin
        .from("ad_placements")
        .select("key")
        .eq("key", data.placementKey)
        .maybeSingle();
      if (!placement) throw new Error("Invalid placement");
    }

    const { data: existing } = await supabaseAdmin
      .from("ad_campaign_targets")
      .select("*")
      .eq("campaign_id", data.campaignId)
      .eq("channel_price_id", data.channelPriceId)
      .eq("status", "draft")
      .maybeSingle();
    if (existing) return existing;

    const { data: row, error } = await supabaseAdmin
      .from("ad_campaign_targets")
      .insert({
        campaign_id: data.campaignId,
        channel_id: price.channelId,
        channel_price_id: price.id,
        placement_key: data.placementKey ?? null,
        status: "draft",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "ad_campaign_target.add",
      entityType: "ad_campaign_target",
      entityId: row.id,
      newData: row,
    });
    return row;
  });

const removeTargetSchema = z.object({ targetId: z.string().uuid() });

// Only a still-'draft' (unpaid) target can be removed -- once a target has
// progressed past draft it is no longer a pending selection, so removal
// through this path is refused (matching how updateCampaignCreative already
// refuses to touch a campaign past its terminal states).
export const removeCampaignTarget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => removeTargetSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await adminClient();
    const { data: target } = await supabaseAdmin
      .from("ad_campaign_targets")
      .select("*, ad_campaigns!inner(user_id)")
      .eq("id", data.targetId)
      .maybeSingle();
    if (!target || target.ad_campaigns.user_id !== context.userId)
      throw new Error("Target not found");
    if (target.status !== "draft") throw new Error("This target can no longer be removed");

    const { error } = await supabaseAdmin
      .from("ad_campaign_targets")
      .delete()
      .eq("id", data.targetId)
      .eq("status", "draft");
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "ad_campaign_target.remove",
      entityType: "ad_campaign_target",
      entityId: data.targetId,
      oldData: target,
    });
    return { ok: true };
  });

// ---------- Admin ----------

const placementSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertAdPlacement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => placementSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("ad_placements")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      key: data.key,
      label: data.label,
      description: data.description ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("ad_placements")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("ad_placements").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "ad_placement.update" : "ad_placement.create",
      entityType: "ad_placement",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListAdPlacements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("ad_placements")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const placementPriceSchema = z.object({
  id: z.string().uuid().optional(),
  appId: z.string().uuid().nullable(),
  placementKey: z.string().trim().min(1),
  pricingStrategy: z.string().trim().min(1).default("fixed_duration"),
  durationDays: z.number().int().min(1),
  price: z.number().min(0),
  currency: z.string().trim().length(3).default("EUR"),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertAdPlacementPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => placementPriceSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("ad_placement_prices")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      app_id: data.appId,
      placement_key: data.placementKey,
      pricing_strategy: data.pricingStrategy,
      duration_days: data.durationDays,
      price: data.price,
      currency: data.currency,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("ad_placement_prices")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("ad_placement_prices").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "ad_placement_price.update" : "ad_placement_price.create",
      entityType: "ad_placement_price",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

const listPricesSchema = z.object({ appId: z.string().uuid().nullable().optional() });

export const adminListAdPlacementPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listPricesSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    let query = context.supabase.from("ad_placement_prices").select("*");
    if (data.appId !== undefined) {
      query = data.appId === null ? query.is("app_id", null) : query.eq("app_id", data.appId);
    }
    const { data: rows, error } = await query.order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const configSchema = z.object({
  key: z.enum(["moderation_mode", "eligibility_rule"]),
  value: z.enum(["manual", "auto", "trusted_only", "anyone", "premium_only", "verified_only"]),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetAdConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => configSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("ad_config")
      .select("value")
      .eq("key", data.key)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("ad_config")
      .upsert({ key: data.key, value: data.value as Json, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "ad_config.set",
      entityType: "ad_config",
      entityId: data.key,
      oldData: previous?.value ?? null,
      newData: data.value,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

const draftExpirySchema = z.object({
  hours: z.number().int().min(1),
  reason: z.string().trim().max(500).optional(),
});

// Separate from adminSetAdConfig above (which is deliberately restricted
// to the two mode/rule enums) since this is a plain number, not one of
// those literal unions -- still the same ad_config table/key.
export const adminSetAdDraftExpiryHours = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => draftExpirySchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("ad_config")
      .select("value")
      .eq("key", "draft_expiry_hours")
      .maybeSingle();

    const { error } = await supabaseAdmin.from("ad_config").upsert({
      key: "draft_expiry_hours",
      value: data.hours as Json,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "ad_config.set",
      entityType: "ad_config",
      entityId: "draft_expiry_hours",
      oldData: previous?.value ?? null,
      newData: data.hours,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

const appSettingsSchema = z.object({
  appId: z.string().uuid(),
  moderationMode: z.enum(["manual", "auto", "trusted_only"]).nullable(),
  eligibilityRule: z.enum(["anyone", "premium_only", "verified_only", "trusted_only"]).nullable(),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetAdApplicationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => appSettingsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("ad_application_settings")
      .select("*")
      .eq("app_id", data.appId)
      .maybeSingle();

    const { data: row, error } = await supabaseAdmin
      .from("ad_application_settings")
      .upsert(
        {
          app_id: data.appId,
          moderation_mode: data.moderationMode,
          eligibility_rule: data.eligibilityRule,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "app_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "ad_application_settings.set",
      entityType: "ad_application_settings",
      entityId: data.appId,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

// Trusted Advertiser status is per-application, not global: trust granted
// for one application says nothing about any other (see
// PROJECT_KNOWLEDGE.md -> Advertising).
const trustedAdvertiserSchema = z.object({
  userId: z.string().uuid(),
  appId: z.string().uuid(),
  trusted: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetTrustedAdvertiser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => trustedAdvertiserSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    if (data.trusted) {
      const { error } = await supabaseAdmin
        .from("ad_trusted_advertisers")
        .upsert(
          { user_id: data.userId, app_id: data.appId, granted_by: context.userId },
          { onConflict: "user_id,app_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("ad_trusted_advertisers")
        .delete()
        .eq("user_id", data.userId)
        .eq("app_id", data.appId);
      if (error) throw new Error(error.message);
    }

    await writeAuditLog({
      userId: context.userId,
      action: data.trusted ? "ad_trusted_advertiser.grant" : "ad_trusted_advertiser.revoke",
      entityType: "ad_trusted_advertiser",
      entityId: data.userId,
      newData: { appId: data.appId },
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

const listTrustedAdvertisersSchema = z.object({ appId: z.string().uuid() });

export const adminListTrustedAdvertisers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listTrustedAdvertisersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data: rows, error } = await supabaseAdmin
      .from("ad_trusted_advertisers")
      .select("*, profiles!ad_trusted_advertisers_user_id_fkey(username, first_name, last_name)")
      .eq("app_id", data.appId)
      .order("granted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const listCampaignsSchema = z.object({
  status: z.enum(["pending", "active", "rejected", "ended", "cancelled"]).optional(),
});

export const adminListCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listCampaignsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    let query = supabaseAdmin
      .from("ad_campaigns")
      .select("*, profiles(username, first_name, last_name), applications(name, slug)");
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query.order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const moderateCampaignSchema = z.object({
  campaignId: z.string().uuid(),
  approve: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const adminModerateCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => moderateCampaignSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("ad_campaigns")
      .select("*")
      .eq("id", data.campaignId)
      .maybeSingle();
    if (!previous || previous.status !== "pending") {
      throw new Error("Campaign is not pending moderation");
    }

    const { data: row, error } = await supabaseAdmin
      .from("ad_campaigns")
      .update({
        status: data.approve ? "active" : "rejected",
        moderation_note: data.note ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.campaignId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.approve ? "ad_campaign.approve" : "ad_campaign.reject",
      entityType: "ad_campaign",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.note ?? null,
    });
    return row;
  });

// Redemptions waiting for the fulfillment step this module owns (see
// Rewards & Loyalty -> fulfillment abstraction). Filtered in application
// code rather than a DB query on the jsonb grant_result, since this list
// is small/admin-only and not a hot path.
export const adminListPendingAdvertisingCreditRedemptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data, error } = await supabaseAdmin
      .from("reward_redemptions")
      .select("*, profiles(username, first_name, last_name)")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).filter((r) => {
      const g = r.grant_result as { status?: string; grantType?: string } | null;
      return g?.grantType === "advertising_credit" && g?.status === "pending_fulfillment";
    });
  });

const fulfillCreditSchema = z.object({ redemptionId: z.string().uuid() });

// The concrete implementation of the fulfillment abstraction described in
// Rewards & Loyalty (Priority 8.3 adjustment): Rewards only ever records a
// redemption plus its fulfillment type; this is the Advertising-owned
// function that turns an 'advertising_credit' redemption into a real,
// spendable ad-account credit. Called by an admin today -- a fully
// automatic version is a reasonable future improvement, not implemented
// now since no trigger/cron infrastructure exists in this codebase.
export const adminFulfillAdvertisingCreditRedemption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => fulfillCreditSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: redemption } = await supabaseAdmin
      .from("reward_redemptions")
      .select("*")
      .eq("id", data.redemptionId)
      .maybeSingle();
    if (!redemption) throw new Error("Redemption not found");

    const grantResult = redemption.grant_result as {
      status?: string;
      grantType?: string;
      grantValue?: { amount?: number; currency?: string };
    } | null;
    if (grantResult?.grantType !== "advertising_credit") {
      throw new Error("This redemption is not an advertising credit");
    }
    if (grantResult?.status !== "pending_fulfillment") {
      throw new Error("This redemption has already been fulfilled");
    }

    const amount = Number(grantResult.grantValue?.amount ?? 0);
    const currency = grantResult.grantValue?.currency ?? "EUR";
    if (amount <= 0) throw new Error("Redemption has no creditable amount");

    const { error: creditErr } = await supabaseAdmin.from("ad_account_credits").insert({
      user_id: redemption.user_id,
      amount,
      currency,
      source: "reward_redemption",
      source_id: redemption.id,
    });
    if (creditErr) throw new Error(creditErr.message);

    const { data: row, error } = await supabaseAdmin
      .from("reward_redemptions")
      .update({
        grant_result: {
          ...grantResult,
          status: "fulfilled",
          fulfilledAt: new Date().toISOString(),
        } as Json,
      })
      .eq("id", data.redemptionId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "ad_account_credit.fulfill_redemption",
      entityType: "reward_redemption",
      entityId: redemption.id,
      oldData: redemption,
      newData: row,
    });
    return { ok: true, amount, currency };
  });

// ---------- Admin: Universal Advertising Distribution Network (Priority 13, Phase C) ----------
//
// Channel *registry* only this phase (type/identity/format-and-media rules/
// duration bounds/notes/app association) -- no pricing (ad_channel_prices)
// and no campaign-target selection/checkout, both deliberately deferred to
// later phases. Same soft-lifecycle registry shape and admin-CRUD pattern as
// ad_placements/adminUpsertAdPlacement above -- no new pattern introduced.

const channelTypeSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertAdChannelType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => channelTypeSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("ad_channel_types")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      key: data.key,
      label: data.label,
      description: data.description ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("ad_channel_types")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("ad_channel_types").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "ad_channel_type.update" : "ad_channel_type.create",
      entityType: "ad_channel_type",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListAdChannelTypes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("ad_channel_types")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const campaignFormatSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertAdCampaignFormat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => campaignFormatSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("ad_campaign_formats")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      key: data.key,
      label: data.label,
      description: data.description ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("ad_campaign_formats")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("ad_campaign_formats").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "ad_campaign_format.update" : "ad_campaign_format.create",
      entityType: "ad_campaign_format",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListAdCampaignFormats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("ad_campaign_formats")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const channelSchema = z.object({
  id: z.string().uuid().optional(),
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().trim().min(1).max(160),
  channelTypeKey: z.string().trim().min(1),
  description: z.string().trim().max(1000).nullable().optional(),
  logoUrl: z.string().trim().nullable().optional(),
  enabled: z.boolean().default(true),
  purchasable: z.boolean().default(true),
  allowedFormatKeys: z.array(z.string().trim().min(1)).max(20).default([]),
  allowedMediaTypes: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  maxFileSizeBytes: z.number().int().positive().nullable().optional(),
  minDurationDays: z.number().int().positive().nullable().optional(),
  maxDurationDays: z.number().int().positive().nullable().optional(),
  displayOrder: z.number().int().default(0),
  externalUrl: z.string().trim().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  integrationId: z.string().trim().max(200).nullable().optional(),
  externalPartner: z.string().trim().max(200).nullable().optional(),
  representsAppId: z.string().uuid().nullable().optional(),
  archived: z.boolean().default(false),
  reason: z.string().trim().max(500).optional(),
});

// The only channel-registry write path -- validates format keys against the
// ad_campaign_formats registry (catches typos/unknown keys at write time,
// matching createDraftCampaign's placementPriceId validation above) and
// reuses the existing URL-safety check for logo/external URLs (CO-1).
export const adminUpsertAdChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => channelSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    if (data.externalUrl && !isSafeProfileUrl(data.externalUrl))
      throw new Error("Invalid external URL");
    if (data.logoUrl && !isSafeProfileUrl(data.logoUrl)) throw new Error("Invalid logo URL");
    if (
      data.minDurationDays != null &&
      data.maxDurationDays != null &&
      data.maxDurationDays < data.minDurationDays
    ) {
      throw new Error("Maximum duration cannot be less than minimum duration");
    }

    if (data.allowedFormatKeys.length > 0) {
      const { data: formats } = await supabaseAdmin
        .from("ad_campaign_formats")
        .select("key")
        .in("key", data.allowedFormatKeys);
      const validKeys = new Set((formats ?? []).map((f) => f.key));
      const unknownKeys = data.allowedFormatKeys.filter((k) => !validKeys.has(k));
      if (unknownKeys.length > 0)
        throw new Error(`Unknown campaign format(s): ${unknownKeys.join(", ")}`);
    }

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("ad_channels")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      key: data.key,
      name: data.name,
      channel_type_key: data.channelTypeKey,
      description: data.description ?? null,
      logo_url: data.logoUrl ?? null,
      enabled: data.enabled,
      purchasable: data.purchasable,
      allowed_format_keys: data.allowedFormatKeys,
      allowed_media_types: data.allowedMediaTypes,
      max_file_size_bytes: data.maxFileSizeBytes ?? null,
      min_duration_days: data.minDurationDays ?? null,
      max_duration_days: data.maxDurationDays ?? null,
      display_order: data.displayOrder,
      external_url: data.externalUrl ?? null,
      notes: data.notes ?? null,
      integration_id: data.integrationId ?? null,
      external_partner: data.externalPartner ?? null,
      represents_app_id: data.representsAppId ?? null,
      archived: data.archived,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("ad_channels")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin.from("ad_channels").insert(payload).select("*").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "ad_channel.update" : "ad_channel.create",
      entityType: "ad_channel",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

export const adminListAdChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("ad_channels")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// Which application(s) a channel is offered under -- a plain association,
// not a soft-lifecycle registry itself (existence = associated), same shape
// as adminSetTrustedAdvertiser above.
const channelAppSchema = z.object({
  channelId: z.string().uuid(),
  appId: z.string().uuid(),
  associated: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetAdChannelApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => channelAppSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    if (data.associated) {
      const { error } = await supabaseAdmin
        .from("ad_channel_apps")
        .upsert(
          { channel_id: data.channelId, app_id: data.appId },
          { onConflict: "channel_id,app_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("ad_channel_apps")
        .delete()
        .eq("channel_id", data.channelId)
        .eq("app_id", data.appId);
      if (error) throw new Error(error.message);
    }

    await writeAuditLog({
      userId: context.userId,
      action: data.associated ? "ad_channel_app.associate" : "ad_channel_app.dissociate",
      entityType: "ad_channel_app",
      entityId: data.channelId,
      newData: { appId: data.appId },
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

const listChannelAppsSchema = z.object({ channelId: z.string().uuid() });

export const adminListAdChannelApps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listChannelAppsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data: rows, error } = await supabaseAdmin
      .from("ad_channel_apps")
      .select("*, applications(name, slug)")
      .eq("channel_id", data.channelId);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- Admin: Placement & Delivery Foundation (Priority 13, Phase D1) ----------
//
// ad_application_placements is "is this placement live, purchasable, and
// how, for THIS application" -- the same division of responsibility as
// ad_channels/ad_channel_apps, applied one level over. purchasable and
// enabled are intentionally independent fields (see PROJECT_KNOWLEDGE.md):
// purchasable gates new sales only; enabled gates delivery of everything,
// including already-active campaigns.

const applicationPlacementSchema = z.object({
  id: z.string().uuid().optional(),
  appId: z.string().uuid(),
  placementKey: z.string().trim().min(1),
  enabled: z.boolean().default(true),
  purchasable: z.boolean().default(true),
  allowedFormatKeys: z.array(z.string().trim().min(1)).max(20).default([]),
  supportedDevices: z
    .array(z.enum(["desktop", "mobile"]))
    .min(1)
    .default(["desktop", "mobile"]),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertAdApplicationPlacement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => applicationPlacementSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    if (data.allowedFormatKeys.length > 0) {
      const { data: formats } = await supabaseAdmin
        .from("ad_campaign_formats")
        .select("key")
        .in("key", data.allowedFormatKeys);
      const validKeys = new Set((formats ?? []).map((f) => f.key));
      const unknownKeys = data.allowedFormatKeys.filter((k) => !validKeys.has(k));
      if (unknownKeys.length > 0)
        throw new Error(`Unknown campaign format(s): ${unknownKeys.join(", ")}`);
    }

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("ad_application_placements")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      app_id: data.appId,
      placement_key: data.placementKey,
      enabled: data.enabled,
      purchasable: data.purchasable,
      allowed_format_keys: data.allowedFormatKeys,
      supported_devices: data.supportedDevices,
      display_order: data.displayOrder,
    };
    const { data: row, error } = data.id
      ? await supabaseAdmin
          .from("ad_application_placements")
          .update(payload)
          .eq("id", data.id)
          .select("*")
          .single()
      : await supabaseAdmin
          .from("ad_application_placements")
          .upsert(payload, { onConflict: "app_id,placement_key" })
          .select("*")
          .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "ad_application_placement.update" : "ad_application_placement.create",
      entityType: "ad_application_placement",
      entityId: row.id,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

const listApplicationPlacementsSchema = z.object({ appId: z.string().uuid().optional() });

// Integration status is computed here, server-side, from last_delivery_at +
// ad_config.integration_freshness_hours (service_role-only, so the raw
// config value is never exposed to the client -- only the derived label).
// "Connected" means only "our delivery endpoint was recently called for
// this placement" -- never a claim that CORE inspected another
// application's code.
export const adminListAdApplicationPlacements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listApplicationPlacementsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    let query = context.supabase.from("ad_application_placements").select("*");
    if (data.appId) query = query.eq("app_id", data.appId);
    const { data: rows, error } = await query.order("display_order", { ascending: true });
    if (error) throw new Error(error.message);

    const supabaseAdmin = await adminClient();
    const { data: config } = await supabaseAdmin
      .from("ad_config")
      .select("value")
      .eq("key", "integration_freshness_hours")
      .maybeSingle();
    const freshnessHours = typeof config?.value === "number" ? config.value : 24;

    return (rows ?? []).map((row) => {
      let integrationStatus: "not_connected" | "connected" | "stale" = "not_connected";
      if (row.last_delivery_at) {
        const ageHours = (Date.now() - new Date(row.last_delivery_at).getTime()) / (1000 * 60 * 60);
        integrationStatus = ageHours <= freshnessHours ? "connected" : "stale";
      }
      return { ...row, integrationStatus };
    });
  });
