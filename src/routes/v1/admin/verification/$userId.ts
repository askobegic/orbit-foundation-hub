// API_CONTRACT.md §19 -- POST /v1/admin/verification/{userId}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({ verified: z.boolean() });

export const Route = createFileRoute("/v1/admin/verification/$userId")({
  server: {
    handlers: {
      POST: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("profiles")
          .update({ is_verified: data.verified })
          .eq("id", params.userId);
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: data.verified ? "verification.approve" : "verification.reject",
          entityType: "profile",
          entityId: params.userId,
          newData: { is_verified: data.verified },
        });

        return apiData({ id: params.userId, isVerified: data.verified });
      }),
    },
  },
});
