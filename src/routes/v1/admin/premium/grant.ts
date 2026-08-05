// API_CONTRACT.md §12 -- POST /v1/admin/premium/grant. Reuses
// addMonthsIso() directly (admin.server.ts) -- the same month-end-safe
// expiry computation adminGrantPremium already uses.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { addMonthsIso, writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  userId: z.string().uuid(),
  appId: z.string().uuid(),
  productId: z.string().uuid().optional(),
  durationMonths: z.number().int().min(1).max(60).default(12),
  reason: z.string().optional(),
});

export const Route = createFileRoute("/v1/admin/premium/grant")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const expiresAt = addMonthsIso(data.durationMonths);
        const { data: sub, error } = await supabaseAdmin
          .from("subscriptions")
          .upsert(
            {
              user_id: data.userId,
              app_id: data.appId,
              plan_id: data.productId ?? null,
              status: "active",
              started_at: new Date().toISOString(),
              expires_at: expiresAt,
              amount_paid: 0,
              currency: "EUR",
            },
            { onConflict: "user_id,app_id" },
          )
          .select("id")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "premium.grant",
          entityType: "subscription",
          entityId: sub.id,
          newData: { ...data, reason: data.reason ?? null },
        });

        return apiData({ purchaseId: sub.id, expiresAt }, 201);
      }),
    },
  },
});
