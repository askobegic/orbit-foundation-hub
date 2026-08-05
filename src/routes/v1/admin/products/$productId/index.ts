// API_CONTRACT.md §12 -- PATCH /v1/admin/products/{productId}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";
import type { Database } from "@/integrations/supabase/types";
import type { SubscriptionPlanRow } from "@/types/database";

type PlanUpdate = Database["public"]["Tables"]["subscription_plans"]["Update"];

function toProduct(row: SubscriptionPlanRow) {
  return {
    id: row.id,
    appId: row.app_id,
    name: row.name,
    productType: row.product_type,
    durationMonths: row.duration_months,
    price: Number(row.price),
    currency: row.currency,
    stripePaymentLink: row.stripe_payment_link,
    paypalPaymentLink: row.paypal_payment_link,
    featuresBs: row.features_bs,
    featuresEn: row.features_en,
    featuresDe: row.features_de,
    isActive: row.is_active,
  };
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  productType: z.enum(["subscription", "promotion", "one_time"]).optional(),
  durationMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).optional(),
  price: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  stripePaymentLink: z.string().url().nullable().optional(),
  paypalPaymentLink: z.string().url().nullable().optional(),
  featuresBs: z.array(z.string()).optional(),
  featuresEn: z.array(z.string()).optional(),
  featuresDe: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export const Route = createFileRoute("/v1/admin/products/$productId/")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const patch: PlanUpdate = {};
        if (data.name !== undefined) patch.name = data.name;
        if (data.productType !== undefined) patch.product_type = data.productType;
        if (data.durationMonths !== undefined) patch.duration_months = data.durationMonths;
        if (data.price !== undefined) patch.price = data.price;
        if (data.currency !== undefined) patch.currency = data.currency;
        if (data.stripePaymentLink !== undefined)
          patch.stripe_payment_link = data.stripePaymentLink;
        if (data.paypalPaymentLink !== undefined)
          patch.paypal_payment_link = data.paypalPaymentLink;
        if (data.featuresBs !== undefined) patch.features_bs = data.featuresBs;
        if (data.featuresEn !== undefined) patch.features_en = data.featuresEn;
        if (data.featuresDe !== undefined) patch.features_de = data.featuresDe;
        if (data.isActive !== undefined) patch.is_active = data.isActive;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("subscription_plans")
          .update(patch)
          .eq("id", params.productId)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "plan.update",
          entityType: "subscription_plan",
          entityId: params.productId,
          newData: row,
        });

        return apiData(toProduct(row as SubscriptionPlanRow));
      }),
    },
  },
});
