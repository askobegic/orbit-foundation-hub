// API_CONTRACT.md §11 -- POST /v1/admin/trials/grant. Reuses
// grantPromotionalTrial() directly (plain function, trial.server.ts) --
// the one place a Trial is ever created.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { grantPromotionalTrial } from "@/lib/trial.server";
import { writeAuditLog } from "@/lib/admin.server";
import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  userId: z.string().uuid(),
  days: z.number().int().min(1),
  reason: z.string().trim().max(500).optional(),
});

const ERROR_MESSAGES: Record<string, string> = {
  invalid_duration: "Duration is outside the allowed range for this policy.",
  already_has_active_trial: "This user already has an active Promotional Trial.",
  source_not_configured: "The admin_grant trial source is disabled.",
  insert_failed: "Could not grant this trial.",
};

export const Route = createFileRoute("/v1/admin/trials/grant")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const result = await grantPromotionalTrial({
          userId: data.userId,
          days: data.days,
          source: "admin_grant",
          grantedBy: admin.userId,
          reason: data.reason ?? null,
        });
        if (!result.ok) {
          const code = result.reason === "invalid_duration" ? "VALIDATION_ERROR" : "CONFLICT";
          throw new ApiError(code, ERROR_MESSAGES[result.reason] ?? "Could not grant this trial.");
        }

        await writeAuditLog({
          userId: admin.userId,
          action: "promotional_trial.grant",
          entityType: "promotional_trial",
          entityId: result.trialId,
          newData: { targetUserId: data.userId, days: data.days, expiresAt: result.expiresAt },
          reason: data.reason ?? null,
        });

        return apiData({ id: result.trialId, expiresAt: result.expiresAt }, 201);
      }),
    },
  },
});
