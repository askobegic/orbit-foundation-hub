// API_CONTRACT.md §13 -- GET/POST /v1/admin/rewards/action-rules. Same
// registry-CRUD shape as /v1/admin/capabilities (§8) -- business logic
// replicated from rewards.functions.ts's adminListRewardActionRules/
// adminUpsertRewardActionRule, since those are requireSupabaseAuth-
// middleware server functions.
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

const createSchema = z.object({
  action: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  label: z.string().trim().min(1).max(120),
  points: z.number().int().min(0),
  cooldownSeconds: z.number().int().min(0).default(0),
  maxPerUser: z.number().int().min(1).nullable().optional(),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/rewards/action-rules/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("reward_action_rules")
          .select("*")
          .order("display_order", { ascending: true });
        if (error) throw new Error(error.message);
        return apiData(((data ?? []) as ActionRuleRow[]).map(toActionRule));
      }),

      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(createSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("reward_action_rules")
          .insert({
            action: data.action,
            label: data.label,
            points: data.points,
            cooldown_seconds: data.cooldownSeconds,
            max_per_user: data.maxPerUser ?? null,
            display_order: data.displayOrder,
            enabled: true,
            archived: false,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "reward_action_rule.create",
          entityType: "reward_action_rule",
          entityId: row.id,
          newData: toActionRule(row as ActionRuleRow),
          reason: data.reason ?? null,
        });

        return apiData(toActionRule(row as ActionRuleRow), 201);
      }),
    },
  },
});
