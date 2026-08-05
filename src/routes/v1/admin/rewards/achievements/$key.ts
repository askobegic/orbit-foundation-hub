// API_CONTRACT.md §13 -- PATCH /v1/admin/rewards/achievements/{key}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

type AchievementRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  trigger_action: string | null;
  trigger_count: number;
  display_order: number;
  enabled: boolean;
  archived: boolean;
};

function toAchievement(row: AchievementRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    triggerAction: row.trigger_action,
    triggerCount: row.trigger_count,
    displayOrder: row.display_order,
    enabled: row.enabled,
    archived: row.archived,
  };
}

const patchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  triggerAction: z.string().trim().nullable().optional(),
  triggerCount: z.number().int().min(1).optional(),
  displayOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/rewards/achievements/$key")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("reward_achievements")
          .select("*")
          .eq("key", params.key)
          .maybeSingle();

        const patch: Partial<AchievementRow> = {};
        if (data.label !== undefined) patch.label = data.label;
        if (data.description !== undefined) patch.description = data.description;
        if (data.triggerAction !== undefined) patch.trigger_action = data.triggerAction;
        if (data.triggerCount !== undefined) patch.trigger_count = data.triggerCount;
        if (data.displayOrder !== undefined) patch.display_order = data.displayOrder;
        if (data.enabled !== undefined) patch.enabled = data.enabled;
        if (data.archived !== undefined) patch.archived = data.archived;

        const { data: row, error } = await supabaseAdmin
          .from("reward_achievements")
          .update(patch)
          .eq("key", params.key)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "reward_achievement.update",
          entityType: "reward_achievement",
          entityId: row.id,
          oldData: previous,
          newData: toAchievement(row as AchievementRow),
          reason: data.reason ?? null,
        });

        return apiData(toAchievement(row as AchievementRow));
      }),
    },
  },
});
