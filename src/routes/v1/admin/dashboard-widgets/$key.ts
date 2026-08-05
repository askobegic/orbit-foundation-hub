// API_CONTRACT.md §9 -- PATCH /v1/admin/dashboard-widgets/{key}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

type DashboardWidgetRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  requires_capability: string | null;
  display_order: number;
  enabled: boolean;
  archived: boolean;
};

function toWidget(row: DashboardWidgetRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    requiresCapability: row.requires_capability,
    displayOrder: row.display_order,
    enabled: row.enabled,
    archived: row.archived,
  };
}

const patchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  requiresCapability: z.string().trim().nullable().optional(),
  displayOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/dashboard-widgets/$key")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("dashboard_widgets")
          .select("*")
          .eq("key", params.key)
          .maybeSingle();

        const patch: Partial<DashboardWidgetRow> = {};
        if (data.label !== undefined) patch.label = data.label;
        if (data.description !== undefined) patch.description = data.description;
        if (data.requiresCapability !== undefined)
          patch.requires_capability = data.requiresCapability;
        if (data.displayOrder !== undefined) patch.display_order = data.displayOrder;
        if (data.enabled !== undefined) patch.enabled = data.enabled;
        if (data.archived !== undefined) patch.archived = data.archived;

        const { data: row, error } = await supabaseAdmin
          .from("dashboard_widgets")
          .update(patch)
          .eq("key", params.key)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "dashboard_widget.update",
          entityType: "dashboard_widget",
          entityId: row.id,
          oldData: previous,
          newData: toWidget(row as DashboardWidgetRow),
          reason: data.reason ?? null,
        });

        return apiData(toWidget(row as DashboardWidgetRow));
      }),
    },
  },
});
