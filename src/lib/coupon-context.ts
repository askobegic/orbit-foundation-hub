// Priority 17: Public Coupons -- preserves a coupon code across the
// registration/login detour (spec section 6/8), the same client-only
// localStorage-plumbing pattern referral.ts already established for
// `?ref=`. This file never writes to the database; the actual redemption
// happens server-side once the user is authenticated (coupons.functions.ts).
const STORAGE_KEY = "orbit_pending_coupon_code";

export function capturePendingCoupon(code: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, code);
}

export function peekPendingCoupon(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function consumePendingCoupon(): string | null {
  if (typeof window === "undefined") return null;
  const code = window.localStorage.getItem(STORAGE_KEY);
  if (code) window.localStorage.removeItem(STORAGE_KEY);
  return code;
}
