// API_CONTRACT.md §12 -- POST /v1/payments/reference. Reuses
// signPaymentReference() directly (payment-reference.server.ts) -- the
// exact same signed reference every existing checkout flow uses.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { signPaymentReference } from "@/lib/payment-reference.server";
import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

const bodySchema = z.object({ productId: z.string().uuid() });

function appendParams(url: string, params: Record<string, string>): string {
  try {
    const u = new URL(url);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  } catch {
    return url;
  }
}

export const Route = createFileRoute("/v1/payments/reference")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: plan, error } = await supabaseAdmin
          .from("subscription_plans")
          .select("id, app_id, is_active, stripe_payment_link, paypal_payment_link")
          .eq("id", data.productId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!plan || !plan.is_active || plan.app_id !== ctx.appId) {
          throw new ApiError(
            "VALIDATION_ERROR",
            "Product does not belong to the calling application, or is inactive",
            [{ field: "productId", issue: "invalid" }],
          );
        }

        const reference = signPaymentReference(ctx.userId, ctx.appId, data.productId);
        return apiData({
          reference,
          stripePaymentLink: plan.stripe_payment_link
            ? appendParams(plan.stripe_payment_link, { client_reference_id: reference })
            : null,
          paypalPaymentLink: plan.paypal_payment_link
            ? appendParams(plan.paypal_payment_link, { custom: reference })
            : null,
        });
      }),
    },
  },
});
