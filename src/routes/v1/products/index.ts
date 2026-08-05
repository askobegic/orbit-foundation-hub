// API_CONTRACT.md §12 -- GET /v1/products.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { resolveAppId } from "@/lib/v1/context.server";
import { resolveLocale, type SupportedLocale } from "@/lib/v1/locale.server";
import type { Json } from "@/integrations/supabase/types";

function asStringArray(value: Json): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function pickFeatures(
  row: { features_bs: Json; features_en: Json; features_de: Json },
  locale: SupportedLocale,
): string[] {
  const en = asStringArray(row.features_en);
  const byLocale =
    locale === "bs"
      ? asStringArray(row.features_bs)
      : locale === "de"
        ? asStringArray(row.features_de)
        : en;
  return byLocale.length ? byLocale : en;
}

export const Route = createFileRoute("/v1/products/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const url = new URL(request.url);
        const appId = await resolveAppId(request, url, { required: true });
        const productType = url.searchParams.get("productType");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let query = supabaseAdmin
          .from("subscription_plans")
          .select("*")
          .eq("app_id", appId!)
          .eq("is_active", true);
        if (productType) query = query.eq("product_type", productType);
        const { data, error } = await query.order("duration_months", { ascending: true });
        if (error) throw new Error(error.message);

        const locale = await resolveLocale({ request, supabaseAdmin, appId });
        return apiData(
          (data ?? []).map((p) => ({
            id: p.id,
            name: p.name,
            productType: p.product_type,
            durationMonths: p.duration_months,
            price: Number(p.price),
            currency: p.currency,
            features: pickFeatures(p, locale),
          })),
        );
      }),
    },
  },
});
