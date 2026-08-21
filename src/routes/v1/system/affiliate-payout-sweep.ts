// Universal CORE Affiliate System -- the external-scheduler hook for
// automatic monthly payout batching (spec section 21/23). Same pattern as
// /v1/system/inactivity-sweep: this codebase has no cron infrastructure,
// so an operator points an external scheduler at this endpoint with the
// shared secret. Batches every Affiliate's approved balance above
// threshold into a new 'pending' affiliate_payouts row -- it does not
// itself move any money (no automated external payout provider is
// integrated here); an Admin still marks each payout 'paid' manually via
// adminMarkAffiliatePayoutPaid once actually sent. Deliberately absent
// from API_CONTRACT.md, same as inactivity-sweep -- an operational
// endpoint, not part of the connected-application contract.
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { runAffiliatePayoutSweep } from "@/lib/affiliate.server";

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/v1/system/affiliate-payout-sweep")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const expected = process.env.SYSTEM_CRON_SECRET;
        if (!expected || !secretMatches(request.headers.get("x-cron-secret"), expected)) {
          throw new ApiError("UNAUTHORIZED", "Invalid or missing cron secret");
        }
        const result = await runAffiliatePayoutSweep();
        return apiData(result);
      }),
    },
  },
});
