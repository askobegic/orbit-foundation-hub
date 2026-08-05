// API_CONTRACT.md §13 -- GET/POST /v1/admin/rewards/fulfillment-types.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

type FulfillmentTypeRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  display_order: number;
  enabled: boolean;
  archived: boolean;
};

function toFulfillmentType(row: FulfillmentTypeRow) {
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

const createSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/rewards/fulfillment-types/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("reward_fulfillment_types")
          .select("*")
          .order("display_order", { ascending: true });
        if (error) throw new Error(error.message);
        return apiData(((data ?? []) as FulfillmentTypeRow[]).map(toFulfillmentType));
      }),

      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(createSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("reward_fulfillment_types")
          .insert({
            key: data.key,
            label: data.label,
            description: data.description ?? null,
            display_order: data.displayOrder,
            enabled: true,
            archived: false,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "reward_fulfillment_type.create",
          entityType: "reward_fulfillment_type",
          entityId: row.id,
          newData: toFulfillmentType(row as FulfillmentTypeRow),
          reason: data.reason ?? null,
        });

        return apiData(toFulfillmentType(row as FulfillmentTypeRow), 201);
      }),
    },
  },
});
