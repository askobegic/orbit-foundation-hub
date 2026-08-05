// Priority 8.7 (R-1 / R-3): the one shared Premium Status Resolver for
// bulk/admin/server-side use.
//
// hasAnyActivePremium() (src/lib/premium.ts) remains the single-user,
// client-callable boolean check via the has_any_active_premium() RPC --
// unchanged, still the one check every user-facing surface (Profile Card,
// Contact Actions, dashboard badges) uses. This file is its server-only
// sibling: every admin bulk operation, and any future /v1 API endpoint,
// must resolve Premium status through resolvePremiumStatus()/
// resolvePremiumStatusBulk() instead of re-deriving "is this user premium"
// from `subscriptions` alone (the exact "two places compute the same
// answer differently" pattern CLAUDE.md calls a defect). Unlike the
// boolean RPC, this exposes the *complete* state -- active, source
// ('subscription' | 'trial' | null), and expires_at -- since a future API
// consumer needs to know not just whether someone is Premium but why and
// until when.
import type { SupabaseClient } from "@supabase/supabase-js";

import { isSubscriptionActiveNow } from "@/lib/subscription";

export type PremiumSource = "subscription" | "trial";

export type PremiumStatus = {
  active: boolean;
  source: PremiumSource | null;
  expiresAt: string | null;
};

const NOBODY = "00000000-0000-0000-0000-000000000000";

// Bulk: two queries total, not N+1. Pass `userIds` to scope the lookup (an
// admin list page checking one page of users); omit it to resolve every
// currently-Premium user platform-wide (a broadcast/stat query). A
// subscription and a trial can never conflict (see Promotional Trial in
// PROJECT_KNOWLEDGE.md) -- when a user has both, the subscription is
// reported as the source, since it's the paid entitlement.
export async function resolvePremiumStatusBulk(
  supabaseAdmin: SupabaseClient,
  userIds?: string[],
): Promise<Map<string, PremiumStatus>> {
  if (userIds && userIds.length === 0) return new Map();

  let subsQuery = supabaseAdmin
    .from("subscriptions")
    .select("user_id, status, expires_at")
    .eq("status", "active");
  let trialsQuery = supabaseAdmin
    .from("promotional_trials")
    .select("user_id, status, expires_at")
    .eq("status", "active");
  if (userIds) {
    subsQuery = subsQuery.in("user_id", userIds);
    trialsQuery = trialsQuery.in("user_id", userIds);
  }

  const [{ data: subs }, { data: trials }] = await Promise.all([subsQuery, trialsQuery]);

  const result = new Map<string, PremiumStatus>();

  for (const s of subs ?? []) {
    if (!s.user_id || !isSubscriptionActiveNow(s)) continue;
    const existing = result.get(s.user_id);
    if (!existing || new Date(s.expires_at) > new Date(existing.expiresAt ?? 0)) {
      result.set(s.user_id, { active: true, source: "subscription", expiresAt: s.expires_at });
    }
  }

  for (const t of trials ?? []) {
    if (!(t.status === "active" && new Date(t.expires_at).getTime() > Date.now())) continue;
    // A subscription always wins as the reported source if the user has
    // both -- see the header comment.
    if (!result.has(t.user_id)) {
      result.set(t.user_id, { active: true, source: "trial", expiresAt: t.expires_at });
    }
  }

  return result;
}

export async function resolvePremiumStatus(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<PremiumStatus> {
  const map = await resolvePremiumStatusBulk(supabaseAdmin, [userId || NOBODY]);
  return map.get(userId) ?? { active: false, source: null, expiresAt: null };
}
