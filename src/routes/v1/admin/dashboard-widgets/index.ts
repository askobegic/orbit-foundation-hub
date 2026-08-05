// API_CONTRACT.md §9 -- GET/POST /v1/admin/dashboard-widgets.
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

const createSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  requiresCapability: z.string().trim().nullable().optional(),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/dashboard-widgets/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("dashboard_widgets")
          .select("*")
          .order("display_order", { ascending: true });
        if (error) throw new Error(error.message);
        return apiData(((data ?? []) as DashboardWidgetRow[]).map(toWidget));
      }),

      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(createSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("dashboard_widgets")
          .insert({
            key: data.key,
            label: data.label,
            description: data.description ?? null,
            requires_capability: data.requiresCapability ?? null,
            display_order: data.displayOrder,
            enabled: true,
            archived: false,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "dashboard_widget.create",
          entityType: "dashboard_widget",
          entityId: row.id,
          newData: toWidget(row as DashboardWidgetRow),
          reason: data.reason ?? null,
        });

        return apiData(toWidget(row as DashboardWidgetRow), 201);
      }),
    },
  },
});
