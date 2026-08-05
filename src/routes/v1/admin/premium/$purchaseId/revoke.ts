// API_CONTRACT.md §12 -- POST /v1/admin/premium/{purchaseId}/revoke.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({ reason: z.string().optional() });

export const Route = createFileRoute("/v1/admin/premium/$purchaseId/revoke")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: sub, error } = await supabaseAdmin
          .from("subscriptions")
          .update({ status: "cancelled", expires_at: new Date().toISOString() })
          .eq("id", params.purchaseId)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "premium.revoke",
          entityType: "subscription",
          entityId: params.purchaseId,
          newData: { reason: data.reason ?? null },
        });

        return apiData({ id: sub.id, status: sub.status });
      }),
    },
  },
});
