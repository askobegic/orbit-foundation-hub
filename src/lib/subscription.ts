import type { SubscriptionStatus } from "@/types/database";

type SubForStatusCheck = { status: SubscriptionStatus; expires_at: string };

// The single place this project defines whether a subscription row is
// currently active. subscriptions.status never auto-transitions to
// "expired" when expires_at passes, so "active" alone is not reliable --
// callers must check both fields together, here, rather than re-deriving
// the same rule inline at each call site.
export function isSubscriptionActiveNow(sub: SubForStatusCheck): boolean {
  return sub.status === "active" && new Date(sub.expires_at).getTime() > Date.now();
}

// Effective display status for a subscription row: what the UI should
// show, accounting for time-based expiry even when the stored status
// column still says "active".
export function effectiveSubscriptionStatus(sub: SubForStatusCheck): SubscriptionStatus {
  if (sub.status === "active" && !isSubscriptionActiveNow(sub)) return "expired";
  return sub.status;
}
