// API_CONTRACT.md §11 -- POST /v1/admin/trials/{trialId}/revoke.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { setTrialStatus } from "@/lib/v1/trial-status.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({ reason: z.string().trim().max(500).optional() });

export const Route = createFileRoute("/v1/admin/trials/$trialId/revoke")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));
        const row = await setTrialStatus(params.trialId, "revoked", admin.userId, data.reason);
        return apiData({
          id: row.id,
          status: row.status,
          source: row.source,
          startsAt: row.starts_at,
          expiresAt: row.expires_at,
          endedAt: row.ended_at,
        });
      }),
    },
  },
});
