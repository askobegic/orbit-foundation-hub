// CORE Notification & User Engagement System -- the external-scheduler
// hook for the 7-day inactivity reminder. This codebase has no cron
// infrastructure (see PROJECT_KNOWLEDGE.md); an operator points an
// external scheduler (Hostinger cron job, GitHub Actions schedule, etc.)
// at this endpoint with the shared secret, matching the timing-safe
// shared-secret comparison pattern already used by
// payment-reference.server.ts, rather than a new auth mechanism. Not part
// of the public applications-facing surface -- deliberately absent from
// API_CONTRACT.md (an operational/infrastructure endpoint, not a
// connected-application contract).
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { runInactivityReminderSweep } from "@/lib/notify.server";

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/v1/system/inactivity-sweep")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const expected = process.env.SYSTEM_CRON_SECRET;
        if (!expected || !secretMatches(request.headers.get("x-cron-secret"), expected)) {
          throw new ApiError("UNAUTHORIZED", "Invalid or missing cron secret");
        }
        const result = await runInactivityReminderSweep();
        return apiData(result);
      }),
    },
  },
});
