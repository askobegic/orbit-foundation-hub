// API_CONTRACT.md §19 -- POST /v1/admin/users/{userId}/reactivate.
import { createFileRoute } from "@tanstack/react-router";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/users/$userId/reactivate")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("profiles")
          .update({ is_active: true })
          .eq("id", params.userId)
          .select("id, is_active")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "user.reactivate",
          entityType: "profile",
          entityId: params.userId,
          newData: { is_active: true },
        });

        return apiData({ id: row.id, isActive: row.is_active });
      }),
    },
  },
});
