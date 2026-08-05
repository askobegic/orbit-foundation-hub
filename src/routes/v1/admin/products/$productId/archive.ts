// API_CONTRACT.md §12 -- POST /v1/admin/products/{productId}/archive.
// Soft-lifecycle only -- sets isActive: false, never a hard delete
// (PROJECT_AUDIT.md -> AD-14).
import { createFileRoute } from "@tanstack/react-router";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/products/$productId/archive")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("subscription_plans")
          .update({ is_active: false })
          .eq("id", params.productId)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "plan.archive",
          entityType: "subscription_plan",
          entityId: params.productId,
          newData: { is_active: false },
        });

        return apiData({ id: row.id, isActive: row.is_active });
      }),
    },
  },
});
