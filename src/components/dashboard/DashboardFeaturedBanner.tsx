// Priority 17: Dashboard Featured Banner -- bottom-of-Dashboard placement
// (spec section 27). Reuses getActivePlacementAd directly (the existing
// single-creative resolver every other placement already uses) -- no new
// resolution logic needed for this one, unlike Dashboard Cards.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Megaphone } from "lucide-react";

import { useApplication } from "@/context/ApplicationContext";
import { getActivePlacementAd, recordAdImpression } from "@/lib/advertising.functions";

export function DashboardFeaturedBanner() {
  const { t } = useTranslation();
  const { application } = useApplication();
  const getAdFn = useServerFn(getActivePlacementAd);
  const recordImpressionFn = useServerFn(recordAdImpression);
  const recordedRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: ["dashboard", "featured-banner", application?.id],
    enabled: !!application?.id,
    queryFn: () =>
      getAdFn({ data: { appId: application!.id, placementKey: "dashboard_featured_banner" } }),
  });

  const ad = query.data;

  useEffect(() => {
    if (!ad || recordedRef.current === ad.campaignId) return;
    recordedRef.current = ad.campaignId;
    void recordImpressionFn({ data: { campaignId: ad.campaignId } });
  }, [ad, recordImpressionFn]);

  if (ad) {
    return (
      <a
        href={ad.linkUrl ?? "#"}
        target="_blank"
        rel="noreferrer sponsored"
        className="block overflow-hidden rounded-2xl border border-gray-100 shadow-sm transition hover:shadow-md"
      >
        {ad.imageUrl ? (
          <img src={ad.imageUrl} alt={ad.title} className="h-32 w-full object-cover sm:h-40" />
        ) : (
          <div className="flex h-32 w-full items-center justify-center bg-gradient-to-r from-[#1D6BF3] to-[#6366F1] px-6 text-center text-lg font-semibold text-white sm:h-40">
            {ad.title}
          </div>
        )}
      </a>
    );
  }

  // Empty state -- an intentionally designed commercial CTA (spec 27),
  // never a broken-looking placeholder.
  return (
    <Link
      to="/dashboard/advertising"
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-10 text-center transition hover:border-[#1D6BF3]/40 hover:bg-gray-50"
    >
      <Megaphone className="h-6 w-6 text-gray-400" />
      <p className="text-sm font-semibold text-gray-600">{t("advertisingSlot.title")}</p>
      <span className="text-xs font-medium text-[#1D6BF3]">{t("advertisingSlot.cta")}</span>
    </Link>
  );
}
