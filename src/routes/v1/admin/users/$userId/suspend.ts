// API_CONTRACT.md §19 -- POST /v1/admin/users/{userId}/suspend.
import { createFileRoute } from "@tanstack/react-router";

import { writeAuditLog } from "@/lib/admin.server";
import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/users/$userId/suspend")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        if (params.userId === admin.userId) {
          throw new ApiError("FORBIDDEN", "You cannot suspend your own account.");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("profiles")
          .update({ is_active: false })
          .eq("id", params.userId)
          .select("id, is_active")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "user.suspend",
          entityType: "profile",
          entityId: params.userId,
          newData: { is_active: false },
        });

        return apiData({ id: row.id, isActive: row.is_active });
      }),
    },
  },
});
