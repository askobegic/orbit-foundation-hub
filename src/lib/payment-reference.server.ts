// Signs/verifies the (user_id, app_id, plan_id) reference threaded through
// Stripe's client_reference_id and PayPal's custom_id.
//
// Closes PROJECT_AUDIT.md -> SE-7: these fields were previously built as a
// plain, unsigned string on the client (src/routes/pricing.tsx), so nothing
// stopped a user from editing the URL before completing checkout to point
// entitlement at a different user_id. Both webhooks already verify the paid
// amount/plan (SE-2/SE-4/SE-14) but had no way to detect a tampered
// identity segment. This is the single shared verifier both webhooks use --
// not duplicated per provider.
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.PAYMENT_REF_SECRET;
  if (!s) throw new Error("PAYMENT_REF_SECRET is not configured");
  return s;
}

function sign(base: string): string {
  return createHmac("sha256", secret()).update(base).digest("hex");
}

export function signPaymentReference(userId: string, appId: string, planId: string): string {
  const base = `${userId}__${appId}__${planId}`;
  return `${base}__${sign(base)}`;
}

export function verifyPaymentReference(
  ref: string | null | undefined,
): { user_id: string; app_id: string; plan_id: string } | null {
  if (!ref) return null;
  const parts = ref.split("__");
  if (parts.length !== 4) return null;
  const [user_id, app_id, plan_id, signature] = parts;
  if (!user_id || !app_id || !plan_id || !signature) return null;

  const expected = sign(`${user_id}__${app_id}__${plan_id}`);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { user_id, app_id, plan_id };
}

// Priority 8.4: Advertising campaign checkout reuses the same webhook
// infrastructure and HMAC signing approach as subscriptions, but with its
// own distinct reference shape (a leading "campaign" tag) so a campaign
// reference and a subscription reference can never be confused with each
// other by either webhook -- verifyPaymentReference above is completely
// unchanged and untouched by this addition.
//
// Carries the campaign id itself, not a plan/price id: this codebase has
// no dynamic Checkout Session creation (subscriptions use static,
// admin-configured Stripe/PayPal Payment Links -- see pricing.tsx), so
// there is no channel to carry campaign creative data (title/image/link)
// through the payment provider. The campaign row is created as 'draft'
// (creative already stored) before checkout; the webhook activates that
// same row by id on payment success rather than creating it from scratch.
export function signCampaignReference(userId: string, appId: string, campaignId: string): string {
  const base = `campaign__${userId}__${appId}__${campaignId}`;
  return `${base}__${sign(base)}`;
}

export function verifyCampaignReference(
  ref: string | null | undefined,
): { user_id: string; app_id: string; campaign_id: string } | null {
  if (!ref) return null;
  const parts = ref.split("__");
  if (parts.length !== 5 || parts[0] !== "campaign") return null;
  const [, user_id, app_id, campaign_id, signature] = parts;
  if (!user_id || !app_id || !campaign_id || !signature) return null;

  const expected = sign(`campaign__${user_id}__${app_id}__${campaign_id}`);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { user_id, app_id, campaign_id };
}

// Priority 17: Public Coupons. Same tagged-reference pattern as campaign
// checkout above -- a coupon-backed purchase still goes through the
// referenced product's own real, static, admin-configured Stripe/PayPal
// Payment Link (this codebase has no dynamic Checkout Session creation),
// so the coupon can only ever "unlock" a product whose OWN price the
// admin has already set to the intended discounted amount -- the
// existing webhook amount/plan verification (SE-2/SE-4) still checks the
// paid amount against that referenced plan's real price, completely
// unchanged. What this reference adds is purely the extra coupon_id tag,
// so the webhook can additionally call redeem_coupon_atomic() once the
// underlying subscription purchase (unchanged logic) succeeds.
export function signCouponReference(
  userId: string,
  appId: string,
  planId: string,
  couponId: string,
): string {
  const base = `coupon__${userId}__${appId}__${planId}__${couponId}`;
  return `${base}__${sign(base)}`;
}

export function verifyCouponReference(
  ref: string | null | undefined,
): { user_id: string; app_id: string; plan_id: string; coupon_id: string } | null {
  if (!ref) return null;
  const parts = ref.split("__");
  if (parts.length !== 6 || parts[0] !== "coupon") return null;
  const [, user_id, app_id, plan_id, coupon_id, signature] = parts;
  if (!user_id || !app_id || !plan_id || !coupon_id || !signature) return null;

  const expected = sign(`coupon__${user_id}__${app_id}__${plan_id}__${coupon_id}`);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { user_id, app_id, plan_id, coupon_id };
}
