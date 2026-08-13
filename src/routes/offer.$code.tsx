// Priority 17: Public Coupons -- the public landing page a coupon code
// resolves to (spec section 9). Discoverable by anyone, no CORE account
// required to view it; redemption requires authentication (spec 6/8).
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Tag, CheckCircle2, XCircle } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useApplication } from "@/context/ApplicationContext";
import { resolvePublicCoupon, createCouponCheckoutReference } from "@/lib/coupons.functions";
import { capturePendingCoupon, consumePendingCoupon } from "@/lib/coupon-context";

export const Route = createFileRoute("/offer/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.code} — Core Platform` },
      { name: "description", content: "Public coupon offer" },
    ],
  }),
  component: OfferPage,
});

function OfferPage() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.slice(0, 2) ?? "bs") as "bs" | "en" | "de";
  const { code } = Route.useParams();
  const { user } = useAuth();
  const { application } = useApplication();
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  const resolveFn = useServerFn(resolvePublicCoupon);
  const checkoutFn = useServerFn(createCouponCheckoutReference);

  const couponQuery = useQuery({
    queryKey: ["public-coupon", code],
    queryFn: () => resolveFn({ data: { code } }),
  });
  const coupon = couponQuery.data;

  async function handleUseCoupon() {
    if (!coupon) return;
    if (!user) {
      // Preserve the code across the auth detour (spec 6/8) -- consumed
      // by auth.callback.tsx/onboarding.tsx once authentication completes.
      capturePendingCoupon(code);
      window.location.href = "/login";
      return;
    }
    setRedeeming(true);
    setRedeemError(null);
    try {
      const result = await checkoutFn({ data: { code } });
      consumePendingCoupon();
      const link = result.stripePaymentLink ?? result.paypalPaymentLink;
      if (!link) {
        setRedeemError(t("offers.coupon.noPaymentLink"));
        setRedeeming(false);
        return;
      }
      const url = new URL(link);
      // Stripe reads client_reference_id, PayPal reads custom -- matching
      // pricing.tsx's own handlePay convention exactly, just with this
      // coupon-tagged reference instead of a plain one.
      if (result.stripePaymentLink) {
        url.searchParams.set("client_reference_id", result.reference);
      } else {
        url.searchParams.set("custom", result.reference);
      }
      window.location.href = url.toString();
    } catch {
      setRedeemError(t("offers.coupon.redeemFailed"));
      setRedeeming(false);
    }
  }

  const title = coupon ? (lang === "en" ? coupon.titleEn : lang === "de" ? coupon.titleDe : coupon.titleBs) : "";
  const description = coupon
    ? lang === "en"
      ? coupon.descriptionEn
      : lang === "de"
        ? coupon.descriptionDe
        : coupon.descriptionBs
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-gray-100">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#1D6BF3] to-[#6366F1] text-sm font-bold text-white">
            {application?.name?.slice(0, 1) ?? "C"}
          </div>
          <span className="text-sm font-semibold text-gray-500">
            {application?.name ?? "Core Platform"}
          </span>
        </div>

        {couponQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-gray-500">{t("common.loading")}</p>
        ) : !coupon ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <XCircle className="h-10 w-10 text-gray-300" />
            <p className="text-sm font-medium text-gray-600">{t("offers.coupon.notFound")}</p>
          </div>
        ) : (
          <>
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#1D6BF3]/10 px-3 py-1 text-xs font-semibold text-[#1D6BF3]">
              <Tag className="h-3.5 w-3.5" />
              {coupon.displayLabel ?? coupon.code}
            </div>
            <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
            {description && <p className="mt-2 text-sm text-gray-600">{description}</p>}

            <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
              <p className="text-sm text-gray-500">{coupon.productName}</p>
              <div className="mt-1 flex items-baseline gap-2">
                {coupon.wasPrice != null && (
                  <span className="text-sm text-gray-400 line-through">
                    {coupon.wasPrice.toFixed(2)} {coupon.currency}
                  </span>
                )}
                <span className="text-2xl font-bold text-gray-900">
                  {coupon.finalPrice.toFixed(2)} {coupon.currency}
                </span>
              </div>
            </div>

            {coupon.valid ? (
              <button
                type="button"
                disabled={redeeming}
                onClick={() => void handleUseCoupon()}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1D6BF3] py-3 text-sm font-semibold text-white transition hover:bg-[#1858cf] disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {redeeming ? t("common.loading") : t("offers.coupon.useCoupon")}
              </button>
            ) : (
              <div className="mt-6 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
                <XCircle className="h-4 w-4 shrink-0" />
                {t(`offers.coupon.invalid.${coupon.invalidReason ?? "expired"}`)}
              </div>
            )}
            {redeemError && <p className="mt-3 text-center text-xs text-red-600">{redeemError}</p>}
            {!user && coupon.valid && (
              <p className="mt-3 text-center text-xs text-gray-400">
                {t("offers.coupon.registerHint")}
              </p>
            )}
          </>
        )}

        <div className="mt-6 border-t border-gray-100 pt-4 text-center">
          <Link to="/" className="text-xs text-gray-400 hover:text-gray-600">
            {application?.name ?? "Core Platform"}
          </Link>
        </div>
      </div>
    </div>
  );
}
