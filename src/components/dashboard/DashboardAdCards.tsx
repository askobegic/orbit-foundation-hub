// Priority 17: Dashboard Cards -- a placement inside the existing
// Advertising system, not a new ad engine. Low on the Dashboard (spec
// section 24), up to 5 simultaneous creatives, fairly rotated server-side
// (getDashboardCardCampaigns). Renders nothing when there are no active
// campaigns -- never a placeholder ad slot here (the Featured Banner
// below is the one placement that shows a "buy advertising" CTA when
// empty).
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useApplication } from "@/context/ApplicationContext";
import { getDashboardCards, recordAdImpression } from "@/lib/advertising.functions";

export function DashboardAdCards() {
  const { application } = useApplication();
  const getCardsFn = useServerFn(getDashboardCards);
  const recordImpressionFn = useServerFn(recordAdImpression);
  const recordedRef = useRef<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["dashboard", "ad-cards", application?.id],
    enabled: !!application?.id,
    queryFn: () => getCardsFn({ data: { appId: application!.id } }),
  });

  const cards = query.data ?? [];

  useEffect(() => {
    for (const card of cards) {
      if (recordedRef.current.has(card.campaignId)) continue;
      recordedRef.current.add(card.campaignId);
      void recordImpressionFn({ data: { campaignId: card.campaignId } });
    }
    // Deliberately only re-runs when the resolved card set changes, not
    // on every render -- recordedRef is what prevents a duplicate
    // impression from React re-rendering the same resolved list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.map((c) => c.campaignId).join(",")]);

  if (cards.length === 0) return null;

  return (
    <div className="flex snap-x gap-3 overflow-x-auto pb-1 sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible lg:grid-cols-5">
      {cards.map((card) => (
        <a
          key={card.campaignId}
          href={card.linkUrl ?? "#"}
          target="_blank"
          rel="noreferrer sponsored"
          className="group block min-w-[140px] max-w-full shrink-0 snap-start overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md sm:min-w-0"
        >
          {card.imageUrl ? (
            <img src={card.imageUrl} alt={card.title} className="h-20 w-full object-cover" />
          ) : (
            <div className="flex h-20 w-full items-center justify-center bg-gray-50 text-xs text-gray-400">
              {card.title}
            </div>
          )}
          <p className="truncate p-2 text-xs font-medium text-gray-700 group-hover:text-[#1D6BF3]">
            {card.title}
          </p>
        </a>
      ))}
    </div>
  );
}
