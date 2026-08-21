// CORE Universal Premium-Locked Content -- the one generic, server-only
// primitive every current and future CORE-connected application uses to
// decide "may this caller receive this protected value?" Combines the two
// CORE eligibility sources that already exist (Global Premium and the
// generic Entitlement/Application Premium Benefit layer, Priority 15C) with
// OR semantics -- it does not introduce a third. CORE evaluates the
// entitlement/benefit here; which field/content actually requires it is
// entirely the calling application's own decision, expressed by which
// requirements it passes in. No application name or id is ever branched on
// in this file. See PROJECT_KNOWLEDGE.md -> Premium-Locked Content.
import type { SupabaseClient } from "@supabase/supabase-js";

import { hasActiveEntitlement } from "@/lib/entitlements.server";
import { resolvePremiumStatus } from "@/lib/premium.server";

export type ContentLockRequirement =
  { type: "global_premium" } | { type: "entitlement"; benefitType: string; appId?: string | null };

// true if the user satisfies ANY of the given requirements (OR, not AND --
// e.g. "Global Premium OR a specific Application Premium Benefit" both
// unlocking the same field). An empty requirements array means nothing can
// unlock the content, so it returns false rather than vacuously true.
export async function isContentUnlocked(
  supabaseAdmin: SupabaseClient,
  userId: string | null,
  requirements: ContentLockRequirement[],
): Promise<boolean> {
  if (!userId) return false;

  for (const requirement of requirements) {
    if (requirement.type === "global_premium") {
      const status = await resolvePremiumStatus(supabaseAdmin, userId);
      if (status.active) return true;
    } else {
      const has = await hasActiveEntitlement(
        userId,
        requirement.benefitType,
        requirement.appId ?? null,
      );
      if (has) return true;
    }
  }

  return false;
}

// The generic "locked field" shape: a Standard (ineligible) caller must be
// able to tell a value exists (so the UI can render "WhatsApp 🔒 Premium"
// instead of hiding the row) without ever receiving the value itself --
// `value` is only ever populated when `locked` is false. `exists: false`
// means the underlying content was never set at all (UI renders the normal
// empty state, e.g. "—", not a lock).
export type LockableField = { exists: boolean; locked: boolean; value: string | null };

export function resolveLockableField(
  rawValue: string | null | undefined,
  unlocked: boolean,
): LockableField {
  const exists = !!rawValue;
  if (!exists) return { exists: false, locked: false, value: null };
  return unlocked
    ? { exists: true, locked: false, value: rawValue! }
    : { exists: true, locked: true, value: null };
}
