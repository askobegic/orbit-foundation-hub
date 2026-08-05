// API_CONTRACT.md §12 -- GET/POST /v1/admin/products.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, withRoute, parseBody, readJsonBody, parseQuery } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";
import type { SubscriptionPlanRow } from "@/types/database";

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

const listQuerySchema = z.object({ appId: z.string().uuid() });

const createSchema = z.object({
  appId: z.string().uuid(),
  name: z.string().min(1),
  productType: z.enum(["subscription", "promotion", "one_time"]).default("subscription"),
  durationMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  price: z.number().nonnegative(),
  currency: z.string().default("EUR"),
  stripePaymentLink: z.string().url().nullable().optional(),
  paypalPaymentLink: z.string().url().nullable().optional(),
  featuresBs: z.array(z.string()).default([]),
  featuresEn: z.array(z.string()).default([]),
  featuresDe: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
});

export const Route = createFileRoute("/v1/admin/products/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const url = new URL(request.url);
        const query = parseQuery(listQuerySchema, url);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("subscription_plans")
          .select("*")
          .eq("app_id", query.appId)
          .order("duration_months", { ascending: true });
        if (error) throw new Error(error.message);
        return apiData(((data ?? []) as SubscriptionPlanRow[]).map(toProduct));
      }),

      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(createSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("subscription_plans")
          .insert({
            app_id: data.appId,
            name: data.name,
            product_type: data.productType,
            duration_months: data.durationMonths,
            price: data.price,
            currency: data.currency,
            stripe_payment_link: data.stripePaymentLink ?? null,
            paypal_payment_link: data.paypalPaymentLink ?? null,
            features_bs: data.featuresBs,
            features_en: data.featuresEn,
            features_de: data.featuresDe,
            is_active: data.isActive,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "plan.create",
          entityType: "subscription_plan",
          entityId: row.id,
          newData: row,
        });

        return apiData(toProduct(row as SubscriptionPlanRow), 201);
      }),
    },
  },
});
