// API_CONTRACT.md §13 -- POST /v1/events (Priority 12 Phase 3). The one
// endpoint every application calls to report an event; recordEvent()
// (events.server.ts) resolves the reward, if any -- the calling application
// never calculates points itself.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { recordEvent } from "@/lib/events.server";
import { processEngagement } from "@/lib/engagement.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";
import { enforceRateLimit } from "@/lib/rate-limit.server";

const bodySchema = z.object({
  eventKey: z.string().trim().min(1).max(60),
  // Who the event is about, if different from the authenticated caller
  // (e.g. comment_received rewards the content owner, not the commenter).
  // Defaults to the caller.
  recipientUserId: z.string().uuid().optional(),
  resourceType: z.string().trim().max(60).nullable().optional(),
  resourceId: z.string().trim().max(200).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  // Application-supplied idempotency key -- see idx_reward_ledger_dedupe.
  // A retried submission with the same key never grants points twice.
  dedupeKey: z.string().trim().max(200).nullable().optional(),
});

export const Route = createFileRoute("/v1/events/")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        // The caller's own JWT is the only source of both "who is acting"
        // (sub) and "which application" (azp) -- API_CONTRACT.md §3.3.
        // Neither is ever accepted from the request body.
        const ctx = await requireUserContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        // Priority 15 Phase C (C8 / PR11-20): the most abuse-exposed
        // Priority 15 surface -- keyed per (application, user) so one
        // noisy caller can't exhaust another's budget. 120 events/minute
        // is generous for real usage while still bounding a flood. Reuses
        // the existing in-memory limiter (src/lib/rate-limit.server.ts,
        // Priority 11 security audit) already protecting auth/session,
        // auth/refresh, and both payment webhooks -- not a second
        // mechanism.
        enforceRateLimit(`v1-events:${ctx.appId}:${ctx.userId}`, 120, 60 * 1000);

        const result = await recordEvent({
          appId: ctx.appId,
          eventKey: data.eventKey,
          actorUserId: ctx.userId,
          recipientUserId: data.recipientUserId ?? ctx.userId,
          resourceType: data.resourceType ?? null,
          resourceId: data.resourceId ?? null,
          metadata: data.metadata,
          dedupeKey: data.dedupeKey ?? null,
          origin: "api",
        });

        // Priority 15 Phase B: Missions/Challenges/Streaks consume the
        // same qualifying-occurrence signal recordEvent()'s own
        // cooldown/limit counters use (granted === points > 0). Never
        // touches recordEvent()/events.server.ts itself, and never throws
        // -- processEngagement() catches its own errors so a Mission/
        // Streak bug can never break event recording or this response.
        if (result.granted) {
          await processEngagement({
            appId: ctx.appId,
            eventKey: data.eventKey,
            recipientUserId: data.recipientUserId ?? ctx.userId,
          });
        }

        return apiData(result);
      }),
    },
  },
});
