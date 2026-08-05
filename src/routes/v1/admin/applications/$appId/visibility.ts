// API_CONTRACT.md §7 -- PUT /v1/admin/applications/{appId}/visibility.
// The one explicit action that changes an application's visibility state --
// kept deliberately separate from PATCH .../{appId} (index.ts in this same
// folder), matching this codebase's existing pattern of state-machine
// transitions (adminSetVerified, adminSetUserActive) being distinct,
// dedicated actions rather than bundled into a generic edit.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  visibility: z.enum(["draft", "coming_soon", "active", "archived"]),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/applications/$appId/visibility")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("applications")
          .select("visibility")
          .eq("id", params.appId)
          .maybeSingle();

        const { data: row, error } = await supabaseAdmin
          .from("applications")
          .update({ visibility: data.visibility })
          .eq("id", params.appId)
          .select("id, visibility")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "application.visibility_change",
          entityType: "application",
          entityId: params.appId,
          oldData: { visibility: previous?.visibility ?? null },
          newData: { visibility: data.visibility },
          reason: data.reason ?? null,
        });

        return apiData({ id: row.id, visibility: row.visibility });
      }),
    },
  },
});
