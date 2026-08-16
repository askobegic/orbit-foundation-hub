// API_CONTRACT.md §7.2 -- PUT /v1/admin/applications/{appId}/launch-status.
// Mirrors visibility.ts (this same folder) exactly: the one explicit
// action that changes an application's Pre-Launch / Public Launch state --
// a dedicated state-machine transition, never bundled into a generic edit.
// See PROJECT_KNOWLEDGE.md -> Pre-Launch / Public Launch.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  launchStatus: z.enum(["pre_launch", "public"]),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/applications/$appId/launch-status")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("applications")
          .select("launch_status")
          .eq("id", params.appId)
          .maybeSingle();

        const { data: row, error } = await supabaseAdmin
          .from("applications")
          .update({ launch_status: data.launchStatus })
          .eq("id", params.appId)
          .select("id, launch_status")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "application.launch_status_change",
          entityType: "application",
          entityId: params.appId,
          oldData: { launch_status: previous?.launch_status ?? null },
          newData: { launch_status: data.launchStatus },
          reason: data.reason ?? null,
        });

        return apiData({ id: row.id, launchStatus: row.launch_status });
      }),
    },
  },
});
