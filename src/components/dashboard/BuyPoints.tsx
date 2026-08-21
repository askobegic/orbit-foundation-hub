// CORE Rewards / Points Purchase -- package selection + checkout, on the
// existing /dashboard/rewards page (spec section 42: "use existing
// Dashboard infrastructure, do not create another Dashboard system").
// Mirrors pricing.tsx's exact purchase flow (signed reference -> static
// Stripe/PayPal Payment Link redirect) -- no new payment mechanism.
// Renders nothing when Buy Points is disabled or there are no active
// packages, same restrained-when-empty convention as SpecialOffers/
// DashboardActions.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Zap } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getStoredAffiliateCode } from "@/lib/affiliate-tracking";
import { registerCheckoutAttribution } from "@/lib/affiliate.functions";
import { createPointsPurchaseReference, getPointsPackages } from "@/lib/points-purchase.functions";

function appendParams(url: string, params: Record<string, string>) {
  try {
    const u = new URL(url);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  } catch {
    return url;
  }
}

type PointsPackage = Awaited<ReturnType<typeof getPointsPackages>>[number];

export function BuyPoints({ appId }: { appId?: string | null }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [buyingId, setBuyingId] = useState<string | null>(null);

  const enabledQuery = useQuery({
    queryKey: ["reward-config", "buy_points_enabled"],
    queryFn: async () => {
      const { data } = await supabase
        .from("reward_config")
        .select("value")
        .eq("key", "buy_points_enabled")
        .maybeSingle();
      return data?.value === true;
    },
  });

  const packagesFn = useServerFn(getPointsPackages);
  const packagesQuery = useQuery({
    queryKey: ["points-packages", appId ?? null],
    enabled: enabledQuery.data === true,
    queryFn: () => packagesFn({ data: { appId: appId ?? null } }),
  });

  const createReferenceFn = useServerFn(createPointsPurchaseReference);
  const registerAttributionFn = useServerFn(registerCheckoutAttribution);

  const packages = packagesQuery.data ?? [];
  if (enabledQuery.data !== true || (!packagesQuery.isLoading && packages.length === 0))
    return null;

  async function handleBuy(pkg: PointsPackage, provider: "stripe" | "paypal") {
    const link = provider === "stripe" ? pkg.stripe_payment_link : pkg.paypal_payment_link;
    if (!link || !user || !appId) return;
    setBuyingId(pkg.id);
    try {
      const affiliateCode = getStoredAffiliateCode();
      if (affiliateCode) {
        await registerAttributionFn({
          data: { sourceProductType: "points_package", sourceProductId: pkg.id, affiliateCode },
        }).catch(() => {});
      }
      const { reference } = await createReferenceFn({ data: { appId, packageId: pkg.id } });
      const url =
        provider === "stripe"
          ? appendParams(link, {
              client_reference_id: reference,
              prefilled_email: user.email ?? "",
            })
          : appendParams(link, { custom: reference });
      window.location.href = url;
    } catch {
      setBuyingId(null);
    }
  }

  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Zap className="h-4 w-4 text-amber-500" />
        {t("pointsPurchase.title")}
      </h2>
      <p className="mt-1 text-xs text-gray-500">{t("pointsPurchase.subtitle")}</p>

      {packagesQuery.isLoading ? (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-32 w-52 shrink-0 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {packages.map((pkg) => (
            <div key={pkg.id} className="flex flex-col rounded-2xl border border-gray-100 p-4">
              <p className="text-sm font-semibold text-gray-900">{pkg.name}</p>
              <p className="mt-1 text-lg font-bold text-[#1D6BF3]">
                {pkg.points_amount + pkg.bonus_points}{" "}
                <span className="text-xs font-normal text-gray-500">Points</span>
              </p>
              {pkg.bonus_points > 0 && (
                <p className="text-[11px] text-emerald-600">
                  {t("pointsPurchase.bonus", { count: pkg.bonus_points })}
                </p>
              )}
              <p className="mt-2 text-sm text-gray-700">
                {Number(pkg.price).toFixed(2)} {pkg.currency}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {pkg.stripe_payment_link && (
                  <button
                    type="button"
                    disabled={buyingId === pkg.id}
                    onClick={() => void handleBuy(pkg, "stripe")}
                    className="rounded-lg bg-[#1D6BF3] py-2 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {t("pointsPurchase.buyWithStripe")}
                  </button>
                )}
                {pkg.paypal_payment_link && (
                  <button
                    type="button"
                    disabled={buyingId === pkg.id}
                    onClick={() => void handleBuy(pkg, "paypal")}
                    className="rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-700 disabled:opacity-50"
                  >
                    {t("pointsPurchase.buyWithPaypal")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
