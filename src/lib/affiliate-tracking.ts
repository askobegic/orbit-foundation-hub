// Universal CORE Affiliate System -- client-side "last valid click wins"
// capture (spec section 15). Deliberately NOT the same mechanic as
// referral.ts's first-touch invite-referral capture -- Affiliate
// attribution is last-touch and time-windowed, a different semantic, so
// this is its own small helper rather than a forced reuse of that one.
// Overwritten on every new affiliate-link visit; read (never written) by
// the checkout flow to register a pending attribution before payment
// (registerCheckoutAttribution, affiliate.functions.ts) -- see
// PROJECT_KNOWLEDGE.md -> Affiliate System for the full cross-domain
// attribution design and its documented limits.
const STORAGE_KEY = "core_affiliate_ref";
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // generous local cap; the real, authoritative window check is server-side against the click's own timestamp.

export function captureAffiliateCode(code: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, capturedAt: Date.now() }));
  } catch {
    // Storage unavailable (private browsing, etc.) -- attribution simply
    // won't apply for this visitor; never block navigation over it.
  }
}

export function getStoredAffiliateCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: string; capturedAt?: number };
    if (!parsed.code || !parsed.capturedAt) return null;
    if (Date.now() - parsed.capturedAt > MAX_AGE_MS) return null;
    return parsed.code;
  } catch {
    return null;
  }
}
