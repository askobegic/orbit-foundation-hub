// Priority 8.5: Promotional Trial -- core business logic.
//
// Plain server-only helpers (matching the rewards.server.ts/
// advertising.server.ts split): grantPromotionalTrial is the one place a
// trial is ever created, called today from trial.functions.ts's
// adminGrantPromotionalTrial and, in the future, from whichever module
// owns the 'promotional_invitation' or 'reward_redemption' trial source
// (see trial_sources) -- granting a trial from a new business rule never
// requires touching this function or its schema, only calling it with a
// different `source`.
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function getMaxTrialDurationDays(): Promise<number> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("trial_policy")
    .select("value")
    .eq("key", "max_duration_days")
    .maybeSingle();
  return typeof data?.value === "number" ? data.value : 90;
}

export async function hasActiveTrial(userId: string): Promise<boolean> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("promotional_trials")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return !!data;
}

export async function grantPromotionalTrial(params: {
  userId: string;
  days: number;
  source: string;
  grantedBy?: string | null;
  sourceReference?: string | null;
  reason?: string | null;
}): Promise<
  | { ok: true; trialId: string; expiresAt: string }
  | { ok: false; reason: "invalid_duration" | "already_has_active_trial" | "source_not_configured" | "insert_failed" }
> {
  const supabaseAdmin = await admin();

  const maxDays = await getMaxTrialDurationDays();
  if (params.days < 1 || params.days > maxDays) {
    return { ok: false, reason: "invalid_duration" };
  }

  // A user cannot have multiple active Trials. Checked here for a clear
  // error message; the partial unique index on promotional_trials
  // (WHERE status = 'active') is the actual, race-safe guarantee -- see
  // the insert error handling below.
  if (await hasActiveTrial(params.userId)) {
    return { ok: false, reason: "already_has_active_trial" };
  }

  const { data: sourceRow } = await supabaseAdmin
    .from("trial_sources")
    .select("key")
    .eq("key", params.source)
    .eq("enabled", true)
    .eq("archived", false)
    .maybeSingle();
  if (!sourceRow) return { ok: false, reason: "source_not_configured" };

  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + params.days * 24 * 60 * 60 * 1000);

  const { data: row, error } = await supabaseAdmin
    .from("promotional_trials")
    .insert({
      user_id: params.userId,
      status: "active",
      source: params.source,
      source_reference: params.sourceReference ?? null,
      granted_by: params.grantedBy ?? null,
      starts_at: startsAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      reason: params.reason ?? null,
    })
    .select("id")
    .single();
  if (error) {
    // 23505 = unique_violation -- the partial unique index rejected a
    // concurrent grant that raced past the pre-check above.
    if (error.code === "23505") return { ok: false, reason: "already_has_active_trial" };
    console.error("grantPromotionalTrial: insert failed", error);
    return { ok: false, reason: "insert_failed" };
  }

  return { ok: true, trialId: row.id, expiresAt: expiresAt.toISOString() };
}
