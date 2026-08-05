// API_CONTRACT.md §13 -- GET/POST /v1/admin/rewards/achievements.
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

const createSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  triggerAction: z.string().trim().nullable().optional(),
  triggerCount: z.number().int().min(1).default(1),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/rewards/achievements/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("reward_achievements")
          .select("*")
          .order("display_order", { ascending: true });
        if (error) throw new Error(error.message);
        return apiData(((data ?? []) as AchievementRow[]).map(toAchievement));
      }),

      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(createSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("reward_achievements")
          .insert({
            key: data.key,
            label: data.label,
            description: data.description ?? null,
            trigger_action: data.triggerAction ?? null,
            trigger_count: data.triggerCount,
            display_order: data.displayOrder,
            enabled: true,
            archived: false,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "reward_achievement.create",
          entityType: "reward_achievement",
          entityId: row.id,
          newData: toAchievement(row as AchievementRow),
          reason: data.reason ?? null,
        });

        return apiData(toAchievement(row as AchievementRow), 201);
      }),
    },
  },
});
