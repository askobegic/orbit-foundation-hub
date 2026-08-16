import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { signPaymentReference } from "@/lib/payment-reference.server";

const createReferenceSchema = z.object({
  app_id: z.string().uuid(),
  plan_id: z.string().uuid(),
});

// The user_id segment comes from the authenticated session (context.userId),
// never from client input -- this is what actually closes SE-7, not just the
// signature. app_id/plan_id are client-selected but checked against the DB
// before being signed, so a signed reference can never point at a plan that
// doesn't belong to the referenced application.
export const createPaymentReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => createReferenceSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: plan, error } = await context.supabase
      .from("subscription_plans")
      .select("id, app_id, is_active, requires_benefit_key")
      .eq("id", data.plan_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const planRow = plan as
      | { id: string; app_id: string; is_active: boolean; requires_benefit_key: string | null }
      | null;
    if (!planRow || !planRow.is_active || planRow.app_id !== data.app_id) {
      throw new Error("Invalid plan for this application");
    }

    // Sponsored-requires-Listing: user-experience pre-check, so the user
    // is never even redirected to Stripe/PayPal for a purchase that would
    // fail its dependency -- prevents the charge entirely in the common
    // case. NOT the authoritative check: the required entitlement can
    // still lapse between this call and webhook confirmation, so the
    // webhook re-checks the same dependency immediately before granting
    // and is what actually decides the outcome (see stripe.ts/paypal.ts).
    if (planRow.requires_benefit_key) {
      const { hasActiveEntitlement } = await import("@/lib/entitlements.server");
      const met = await hasActiveEntitlement(context.userId, planRow.requires_benefit_key, data.app_id);
      if (!met) throw new Error("dependency_not_met");
    }

    return { reference: signPaymentReference(context.userId, data.app_id, data.plan_id) };
  });
