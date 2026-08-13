// Priority 17: "SPECIJALNO ZA VAS" -- Global + Individual offers.
// Deliberately restrained styling (spec section 15/16): a personal-
// benefit section, not an ad unit. Renders nothing at all when there are
// zero eligible offers (spec section 17).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Gift } from "lucide-react";

import { resolveMyOffers, type ResolvedOffer } from "@/lib/offers.functions";

function validityParts(endsAt: string, locale: string): { month: string; year: number } {
  const d = new Date(endsAt);
  return { month: d.toLocaleDateString(locale, { month: "long" }), year: d.getFullYear() };
}

function OfferCard({ offer }: { offer: ResolvedOffer }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.slice(0, 2) ?? "bs") as "bs" | "en" | "de";
  const title = offer[`title${cap(lang)}` as "titleBs" | "titleEn" | "titleDe"];
  const cta = offer[`cta${cap(lang)}` as "ctaBs" | "ctaEn" | "ctaDe"] || t("offers.useOffer");

  return (
    <div className="flex min-w-[260px] max-w-full flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        {offer.discountType === "percent" && offer.discountPercent != null && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
            -{offer.discountPercent}%
          </span>
        )}
        {offer.badgeIcon && <span aria-hidden="true">{offer.badgeIcon}</span>}
      </div>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-0.5 text-xs text-gray-500">{offer.productName}</p>
      <div className="mt-3 flex items-baseline gap-2">
        {offer.wasPrice != null && (
          <span className="text-sm text-gray-400 line-through">{offer.wasPrice.toFixed(2)} €</span>
        )}
        <span className="text-xl font-bold text-gray-900">{offer.finalPrice.toFixed(2)} €</span>
      </div>
      <p className="mt-1 text-xs text-gray-400">
        {t("offers.validUntil", validityParts(offer.endsAt, i18n.language))}
      </p>
      {/* Full discounted-checkout for Offers (bypassing Pricing) is not
          wired in this pass -- the CTA takes the user to the existing,
          fully-functional checkout surface for that product type, where
          the referenced (already-discounted) product is one of the real
          options. Public Coupons are the one mechanism with a dedicated,
          fully wired checkout flow (see /offer/:code). */}
      <Link
        to={offer.productType === "subscription_plan" ? "/pricing" : "/dashboard/advertising"}
        className="mt-4 rounded-xl bg-[#1D6BF3] py-2 text-center text-sm font-medium text-white transition hover:bg-[#1858cf]"
      >
        {cta}
      </Link>
    </div>
  );
}

function cap(lang: "bs" | "en" | "de"): "Bs" | "En" | "De" {
  return (lang.charAt(0).toUpperCase() + lang.slice(1)) as "Bs" | "En" | "De";
}

export function SpecialOffers({ userId }: { userId?: string }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const resolveFn = useServerFn(resolveMyOffers);

  const query = useQuery({
    queryKey: ["dashboard", "my-offers", userId],
    enabled: !!userId,
    queryFn: () => resolveFn(),
  });

  const offers = query.data ?? [];
  // Spec section 17: 0 offers renders nothing at all.
  if (!query.isLoading && offers.length === 0) return null;

  const VISIBLE_LIMIT = 3;
  const visible = showAll ? offers : offers.slice(0, VISIBLE_LIMIT);
  const hasMore = offers.length > VISIBLE_LIMIT;

  return (
    <section className="rounded-2xl bg-gradient-to-br from-indigo-50/60 to-white p-6 ring-1 ring-gray-100">
      <div className="mb-1 flex items-center gap-2">
        <Gift className="h-4 w-4 text-[#8B5CF6]" />
        <h3 className="text-sm font-bold text-gray-900">{t("offers.title")}</h3>
      </div>
      <p className="mb-4 text-xs text-gray-500">{t("offers.subtitle")}</p>

      {query.isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-40 w-64 shrink-0 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : (
        <>
          <div className="flex snap-x gap-3 overflow-x-auto pb-1 sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
            {visible.map((offer) => (
              <div key={offer.id} className="snap-start">
                <OfferCard offer={offer} />
              </div>
            ))}
          </div>
          {hasMore && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-4 text-xs font-medium text-[#1D6BF3] hover:underline"
            >
              {t("offers.viewAll")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
