// Priority 8.3: Rewards & Loyalty -- referral link capture.
//
// Client-only plumbing: first-touch capture of `?ref=<username>` into
// localStorage, consumed once at onboarding completion. The actual
// crediting/linking happens server-side via rewards.functions.ts's
// linkReferral -- this file never writes to the database.
const STORAGE_KEY = "orbit_referral_username";

export function captureReferralFromUrl(): void {
  if (typeof window === "undefined") return;
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (!ref) return;
  // First-touch only: never overwrite a referral captured earlier in the
  // same browser.
  if (window.localStorage.getItem(STORAGE_KEY)) return;
  window.localStorage.setItem(STORAGE_KEY, ref);
}

export function consumeReferral(): string | null {
  if (typeof window === "undefined") return null;
  const ref = window.localStorage.getItem(STORAGE_KEY);
  if (ref) window.localStorage.removeItem(STORAGE_KEY);
  return ref;
}
