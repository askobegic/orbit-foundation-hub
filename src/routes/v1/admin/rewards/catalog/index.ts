// API_CONTRACT.md §13 -- GET/POST /v1/admin/rewards/catalog.
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

const createSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case only"),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  pointsCost: z.number().int().min(0),
  verifiedReferralsRequired: z.number().int().min(0).default(0),
  grantType: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/),
  grantValue: z.record(z.string(), z.unknown()).default({}),
  requiresCapability: z.string().trim().nullable().optional(),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/rewards/catalog/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("reward_catalog")
          .select("*")
          .order("display_order", { ascending: true });
        if (error) throw new Error(error.message);
        return apiData(((data ?? []) as CatalogRow[]).map(toCatalogItem));
      }),

      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(createSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("reward_catalog")
          .insert({
            key: data.key,
            label: data.label,
            description: data.description ?? null,
            points_cost: data.pointsCost,
            verified_referrals_required: data.verifiedReferralsRequired,
            grant_type: data.grantType,
            grant_value: data.grantValue as Json,
            requires_capability: data.requiresCapability ?? null,
            display_order: data.displayOrder,
            enabled: true,
            archived: false,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "reward_catalog.create",
          entityType: "reward_catalog",
          entityId: row.id,
          newData: toCatalogItem(row as CatalogRow),
          reason: data.reason ?? null,
        });

        return apiData(toCatalogItem(row as CatalogRow), 201);
      }),
    },
  },
});
