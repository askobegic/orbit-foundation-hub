// API_CONTRACT.md -- POST /v1/affiliate/conversions. The one endpoint a
// connected application uses to report its own confirmed transaction for
// Affiliate attribution -- CORE never sees or stores the application's
// order/payment/product data beyond what's passed here (eligible amount,
// currency, the application's own transaction reference). Authenticated
// exactly like POST /v1/events -- the caller's own JWT is the only source
// of both "who is acting" (converted user, sub) and "which application"
// (azp), never accepted from the request body.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { recordApplicationConversion } from "@/lib/affiliate.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";
import { enforceRateLimit } from "@/lib/rate-limit.server";

const bodySchema = z.object({
  affiliateCode: z.string().trim().min(1).max(60),
  sourceProductType: z.string().trim().min(1).max(60),
  sourceProductId: z.string().trim().min(1).max(200),
  // The application's own transaction/order id -- the idempotency key
  // (affiliate_conversions.transaction_ref is UNIQUE), so a retried
  // report of the same transaction can never create a second conversion.
  transactionRef: z.string().trim().min(1).max(200),
  eligibleAmount: z.number().nonnegative(),
  currency: z.string().trim().length(3),
});

export const Route = createFileRoute("/v1/affiliate/conversions/")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        enforceRateLimit(`v1-affiliate-conversions:${ctx.appId}`, 60, 60 * 1000);

        const result = await recordApplicationConversion({
          code: data.affiliateCode,
          convertedUserId: ctx.userId,
          appId: ctx.appId,
          sourceProductType: data.sourceProductType,
          sourceProductId: data.sourceProductId,
          transactionRef: `${ctx.appId}:${data.transactionRef}`,
          eligibleAmount: data.eligibleAmount,
          currency: data.currency.toUpperCase(),
        });

        return apiData(result);
      }),
    },
  },
});
