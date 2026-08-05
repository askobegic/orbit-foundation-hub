// API_CONTRACT.md §14 -- PATCH /v1/admin/advertising/prices/{id}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

type PriceRow = {
  id: string;
  app_id: string | null;
  placement_key: string;
  pricing_strategy: string;
  duration_days: number;
  price: number;
  currency: string;
  stripe_payment_link: string | null;
  paypal_payment_link: string | null;
  display_order: number;
  enabled: boolean;
  archived: boolean;
};

function toPrice(row: PriceRow) {
  return {
    id: row.id,
    appId: row.app_id,
    placementKey: row.placement_key,
    pricingStrategy: row.pricing_strategy,
    durationDays: row.duration_days,
    price: Number(row.price),
    currency: row.currency,
    stripePaymentLink: row.stripe_payment_link,
    paypalPaymentLink: row.paypal_payment_link,
    displayOrder: row.display_order,
    enabled: row.enabled,
    archived: row.archived,
  };
}

const patchSchema = z.object({
  placementKey: z.string().trim().min(1).optional(),
  durationDays: z.number().int().min(1).optional(),
  price: z.number().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
  stripePaymentLink: z.string().trim().nullable().optional(),
  paypalPaymentLink: z.string().trim().nullable().optional(),
  displayOrder: z.number().int().optional(),
  enabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/advertising/prices/$id")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("ad_placement_prices")
          .select("*")
          .eq("id", params.id)
          .maybeSingle();

        const patch: Partial<PriceRow> = {};
        if (data.placementKey !== undefined) patch.placement_key = data.placementKey;
        if (data.durationDays !== undefined) patch.duration_days = data.durationDays;
        if (data.price !== undefined) patch.price = data.price;
        if (data.currency !== undefined) patch.currency = data.currency;
        if (data.stripePaymentLink !== undefined)
          patch.stripe_payment_link = data.stripePaymentLink;
        if (data.paypalPaymentLink !== undefined)
          patch.paypal_payment_link = data.paypalPaymentLink;
        if (data.displayOrder !== undefined) patch.display_order = data.displayOrder;
        if (data.enabled !== undefined) patch.enabled = data.enabled;
        if (data.archived !== undefined) patch.archived = data.archived;

        const { data: row, error } = await supabaseAdmin
          .from("ad_placement_prices")
          .update(patch)
          .eq("id", params.id)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "ad_placement_price.update",
          entityType: "ad_placement_price",
          entityId: row.id,
          oldData: previous,
          newData: toPrice(row as PriceRow),
          reason: data.reason ?? null,
        });

        return apiData(toPrice(row as PriceRow));
      }),
    },
  },
});
