// API_CONTRACT.md -- POST /v1/affiliate/conversions/{transactionRef}/reverse.
// The application's own confirmation that a transaction it previously
// reported (POST /v1/affiliate/conversions) was cancelled, refunded,
// returned, or charged back -- CORE's commission ledger must never remain
// incorrectly payable once the originating transaction no longer is (spec
// section 20). {transactionRef} is the same value the application
// originally supplied; the `{appId}:` prefix this API applies internally
// is handled transparently.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { reverseAffiliateConversion } from "@/lib/affiliate.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";
import { enforceRateLimit } from "@/lib/rate-limit.server";

const bodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const Route = createFileRoute("/v1/affiliate/conversions/$transactionRef/reverse")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        enforceRateLimit(`v1-affiliate-reverse:${ctx.appId}`, 60, 60 * 1000);

        // Only the reporting application's own namespaced reference can be
        // reversed -- an application can never reverse another
        // application's conversion, even if it somehow guessed its ref.
        const result = await reverseAffiliateConversion(
          `${ctx.appId}:${params.transactionRef}`,
          data.reason,
        );
        return apiData(result);
      }),
    },
  },
});
