// API_CONTRACT.md §8 -- GET /v1/admin/capabilities, POST /v1/admin/capabilities.
// Business logic replicated from capabilities.functions.ts's
// adminListCapabilityDefinitions/adminUpsertCapabilityDefinition -- not
// reused by direct call, since those are requireSupabaseAuth-middleware
// server functions expecting a raw Supabase session JWT (this route
// authenticates via the CORE JWT instead) -- same queries, same audit
// actions, same response shape, just re-verified via requireAdminContext.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

type CapabilityDefinitionRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  display_order: number;
  enabled: boolean;
  archived: boolean;
};

function toCapability(row: CapabilityDefinitionRow) {
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

export const Route = createFileRoute("/v1/admin/capabilities/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("capability_definitions")
          .select("*")
          .order("display_order", { ascending: true });
        if (error) throw new Error(error.message);
        return apiData(((data ?? []) as CapabilityDefinitionRow[]).map(toCapability));
      }),

      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(createSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("capability_definitions")
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
          action: "capability_definition.create",
          entityType: "capability_definition",
          entityId: row.id,
          newData: toCapability(row as CapabilityDefinitionRow),
          reason: data.reason ?? null,
        });

        return apiData(toCapability(row as CapabilityDefinitionRow), 201);
      }),
    },
  },
});
