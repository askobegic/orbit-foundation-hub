// API_CONTRACT.md §13 -- GET/POST /v1/admin/rewards/levels.
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

const createSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  label: z.string().trim().min(1).max(120),
  minLifetimePoints: z.number().int().min(0).default(0),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/rewards/levels/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("reward_levels")
          .select("*")
          .order("display_order", { ascending: true });
        if (error) throw new Error(error.message);
        return apiData(((data ?? []) as LevelRow[]).map(toLevel));
      }),

      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(createSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("reward_levels")
          .insert({
            key: data.key,
            label: data.label,
            min_lifetime_points: data.minLifetimePoints,
            display_order: data.displayOrder,
            enabled: true,
            archived: false,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "reward_level.create",
          entityType: "reward_level",
          entityId: row.id,
          newData: toLevel(row as LevelRow),
          reason: data.reason ?? null,
        });

        return apiData(toLevel(row as LevelRow), 201);
      }),
    },
  },
});
