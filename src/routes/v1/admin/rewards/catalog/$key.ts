// API_CONTRACT.md §13 -- PATCH /v1/admin/rewards/catalog/{key}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

type CatalogRow = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  points_cost: number;
  verified_referrals_required: number;
  grant_type: string;
  grant_value: Json;
  requires_capability: string | null;
  display_order: number;
  enabled: boolean;
  archived: boolean;
};

function toCatalogItem(row: CatalogRow) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    pointsCost: row.points_cost,
    verifiedReferralsRequired: row.verified_referrals_required,
    grantType: row.grant_type,
    grantValue: row.grant_value,
    requiresCapability: row.requires_capability,
    displayOrder: row.display_order,
    enabled: row.enabled,
    archived: row.archived,
  };
}

const patchSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  pointsCost: z.number().int().min(0).optional(),
  verifiedReferralsRequired: z.number().int().min(0).optional(),
  grantType: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
  grantValue: z.record(z.string(), z.unknown()).optional(),
  requiresCapability: z.string().trim().nullable().optional(),
  displayOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/rewards/catalog/$key")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("reward_catalog")
          .select("*")
          .eq("key", params.key)
          .maybeSingle();

        const patch: Partial<CatalogRow> = {};
        if (data.label !== undefined) patch.label = data.label;
        if (data.description !== undefined) patch.description = data.description;
        if (data.pointsCost !== undefined) patch.points_cost = data.pointsCost;
        if (data.verifiedReferralsRequired !== undefined)
          patch.verified_referrals_required = data.verifiedReferralsRequired;
        if (data.grantType !== undefined) patch.grant_type = data.grantType;
        if (data.grantValue !== undefined) patch.grant_value = data.grantValue as Json;
        if (data.requiresCapability !== undefined)
          patch.requires_capability = data.requiresCapability;
        if (data.displayOrder !== undefined) patch.display_order = data.displayOrder;
        if (data.enabled !== undefined) patch.enabled = data.enabled;
        if (data.archived !== undefined) patch.archived = data.archived;

        const { data: row, error } = await supabaseAdmin
          .from("reward_catalog")
          .update(patch)
          .eq("key", params.key)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "reward_catalog.update",
          entityType: "reward_catalog",
          entityId: row.id,
          oldData: previous,
          newData: toCatalogItem(row as CatalogRow),
          reason: data.reason ?? null,
        });

        return apiData(toCatalogItem(row as CatalogRow));
      }),
    },
  },
});
