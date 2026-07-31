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
