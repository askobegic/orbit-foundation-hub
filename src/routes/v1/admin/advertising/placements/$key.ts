// API_CONTRACT.md §14 -- PATCH /v1/admin/advertising/placements/{key}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

type PlacementRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  display_order: number;
  enabled: boolean;
  archived: boolean;
};

function toPlacement(row: PlacementRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    displayOrder: row.display_order,
    enabled: row.enabled,
    archived: row.archived,
  };
}

const patchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  displayOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/advertising/placements/$key")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("ad_placements")
          .select("*")
          .eq("key", params.key)
          .maybeSingle();

        const patch: Partial<PlacementRow> = {};
        if (data.label !== undefined) patch.label = data.label;
        if (data.description !== undefined) patch.description = data.description;
        if (data.displayOrder !== undefined) patch.display_order = data.displayOrder;
        if (data.enabled !== undefined) patch.enabled = data.enabled;
        if (data.archived !== undefined) patch.archived = data.archived;

        const { data: row, error } = await supabaseAdmin
          .from("ad_placements")
          .update(patch)
          .eq("key", params.key)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "ad_placement.update",
          entityType: "ad_placement",
          entityId: row.id,
          oldData: previous,
          newData: toPlacement(row as PlacementRow),
          reason: data.reason ?? null,
        });

        return apiData(toPlacement(row as PlacementRow));
      }),
    },
  },
});
