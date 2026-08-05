// API_CONTRACT.md §14 -- GET/POST /v1/admin/advertising/prices.
// ?appId= optional filter; omit for all rows, ?appId=null for global-only.
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

const createSchema = z.object({
  appId: z.string().uuid().nullable(),
  placementKey: z.string().trim().min(1),
  pricingStrategy: z.string().trim().min(1).default("fixed_duration"),
  durationDays: z.number().int().min(1),
  price: z.number().min(0),
  currency: z.string().trim().length(3).default("EUR"),
  stripePaymentLink: z.string().trim().nullable().optional(),
  paypalPaymentLink: z.string().trim().nullable().optional(),
  displayOrder: z.number().int().default(0),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/advertising/prices/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const url = new URL(request.url);
        const appId = url.searchParams.get("appId");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let query = supabaseAdmin.from("ad_placement_prices").select("*");
        if (appId !== null) {
          query = appId === "null" ? query.is("app_id", null) : query.eq("app_id", appId);
        }
        const { data, error } = await query.order("display_order", { ascending: true });
        if (error) throw new Error(error.message);
        return apiData(((data ?? []) as PriceRow[]).map(toPrice));
      }),

      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(createSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("ad_placement_prices")
          .insert({
            app_id: data.appId,
            placement_key: data.placementKey,
            pricing_strategy: data.pricingStrategy,
            duration_days: data.durationDays,
            price: data.price,
            currency: data.currency,
            stripe_payment_link: data.stripePaymentLink ?? null,
            paypal_payment_link: data.paypalPaymentLink ?? null,
            display_order: data.displayOrder,
            enabled: true,
            archived: false,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "ad_placement_price.create",
          entityType: "ad_placement_price",
          entityId: row.id,
          newData: toPrice(row as PriceRow),
          reason: data.reason ?? null,
        });

        return apiData(toPrice(row as PriceRow), 201);
      }),
    },
  },
});
