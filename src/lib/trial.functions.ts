import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TRIAL_DAYS = 7;

/**
 * Activates a 7-day free trial for the current user across all active apps.
 * Idempotent: if the user already has any active subscription, does nothing.
 */
export const activateTrialIfEligible = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Check for any existing active subscription (trial or paid).
    const { data: existing, error: existingErr } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .limit(1);
    if (existingErr) throw new Error(existingErr.message);
    if (existing && existing.length > 0) return { activated: false, reason: "already_active" };

    // Also check we haven't already used a trial before.
    const { data: pastTrial } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("user_id", userId)
      .eq("stripe_payment_id", "trial_7days")
      .limit(1);
    if (pastTrial && pastTrial.length > 0) return { activated: false, reason: "already_used" };

    const { data: apps, error: appsErr } = await supabase
      .from("applications")
      .select("id")
      .eq("status", "active");
    if (appsErr) throw new Error(appsErr.message);
    if (!apps || apps.length === 0) return { activated: false, reason: "no_apps" };

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    const rows = apps.map((a) => ({
      user_id: userId,
      app_id: a.id,
      status: "active",
      stripe_payment_id: "trial_7days",
      amount_paid: 0,
      currency: "EUR",
      started_at: startedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    }));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: insErr } = await supabaseAdmin
      .from("subscriptions")
      .upsert(rows as never, { onConflict: "user_id,app_id" });
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin.from("audit_logs").insert({
      user_id: userId,
      action: "trial_activated",
      entity_type: "subscription",
      new_data: { days: TRIAL_DAYS, apps: apps.length, expires_at: expiresAt.toISOString() },
    } as never);

    return { activated: true, expires_at: expiresAt.toISOString() };
  });