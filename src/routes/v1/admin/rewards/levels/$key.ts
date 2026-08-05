// API_CONTRACT.md §13 -- PATCH /v1/admin/rewards/levels/{key}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

type LevelRow = {
  id: string;
  key: string;
  label: string;
  min_lifetime_points: number;
  display_order: number;
  enabled: boolean;
  archived: boolean;
};

function toLevel(row: LevelRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    minLifetimePoints: row.min_lifetime_points,
    displayOrder: row.display_order,
    enabled: row.enabled,
    archived: row.archived,
  };
}

const patchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  minLifetimePoints: z.number().int().min(0).optional(),
  displayOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/rewards/levels/$key")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("reward_levels")
          .select("*")
          .eq("key", params.key)
          .maybeSingle();

        const patch: Partial<LevelRow> = {};
        if (data.label !== undefined) patch.label = data.label;
        if (data.minLifetimePoints !== undefined)
          patch.min_lifetime_points = data.minLifetimePoints;
        if (data.displayOrder !== undefined) patch.display_order = data.displayOrder;
        if (data.enabled !== undefined) patch.enabled = data.enabled;
        if (data.archived !== undefined) patch.archived = data.archived;

        const { data: row, error } = await supabaseAdmin
          .from("reward_levels")
          .update(patch)
          .eq("key", params.key)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "reward_level.update",
          entityType: "reward_level",
          entityId: row.id,
          oldData: previous,
          newData: toLevel(row as LevelRow),
          reason: data.reason ?? null,
        });

        return apiData(toLevel(row as LevelRow));
      }),
    },
  },
});
