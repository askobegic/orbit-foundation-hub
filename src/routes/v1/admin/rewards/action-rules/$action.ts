// API_CONTRACT.md §13 -- PATCH /v1/admin/rewards/action-rules/{action}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

type ActionRuleRow = {
  id: string;
  action: string;
  label: string;
  points: number;
  cooldown_seconds: number;
  max_per_user: number | null;
  display_order: number;
  enabled: boolean;
  archived: boolean;
};

function toActionRule(row: ActionRuleRow) {
  return {
    id: row.id,
    action: row.action,
    label: row.label,
    points: row.points,
    cooldownSeconds: row.cooldown_seconds,
    maxPerUser: row.max_per_user,
    displayOrder: row.display_order,
    enabled: row.enabled,
    archived: row.archived,
  };
}

const patchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  points: z.number().int().min(0).optional(),
  cooldownSeconds: z.number().int().min(0).optional(),
  maxPerUser: z.number().int().min(1).nullable().optional(),
  displayOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/rewards/action-rules/$action")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("reward_action_rules")
          .select("*")
          .eq("action", params.action)
          .maybeSingle();

        const patch: Partial<ActionRuleRow> = {};
        if (data.label !== undefined) patch.label = data.label;
        if (data.points !== undefined) patch.points = data.points;
        if (data.cooldownSeconds !== undefined) patch.cooldown_seconds = data.cooldownSeconds;
        if (data.maxPerUser !== undefined) patch.max_per_user = data.maxPerUser;
        if (data.displayOrder !== undefined) patch.display_order = data.displayOrder;
        if (data.enabled !== undefined) patch.enabled = data.enabled;
        if (data.archived !== undefined) patch.archived = data.archived;

        const { data: row, error } = await supabaseAdmin
          .from("reward_action_rules")
          .update(patch)
          .eq("action", params.action)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "reward_action_rule.update",
          entityType: "reward_action_rule",
          entityId: row.id,
          oldData: previous,
          newData: toActionRule(row as ActionRuleRow),
          reason: data.reason ?? null,
        });

        return apiData(toActionRule(row as ActionRuleRow));
      }),
    },
  },
});
