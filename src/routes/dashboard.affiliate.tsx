// Universal CORE Affiliate System -- the Affiliate Dashboard (spec section
// 27). Reachable from the existing "Postani Affiliate" Dashboard Action
// (dashboard_actions, Priority 21) once eligible, and from the "My
// Resources" card once already an Affiliate (see affiliate.server.ts's
// becomeAffiliate()) -- this route itself handles both the join flow and
// the active-Affiliate dashboard, so neither prompt needs its own
// destination logic.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Handshake, Link2, MousePointerClick, Wallet } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardMobileNav } from "@/components/dashboard/DashboardNav";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getAffiliateCatalog,
  getMyAffiliateDashboard,
  getMyAffiliateLink,
  joinAffiliateProgram,
} from "@/lib/affiliate.functions";

export const Route = createFileRoute("/dashboard/affiliate")({
  head: () => ({
    meta: [{ title: "Affiliate — Core Platform" }],
  }),
  component: () => (
    <ProtectedRoute>
      <AffiliatePage />
    </ProtectedRoute>
  ),
});

const STATUS_LABEL_KEY: Record<string, string> = {
  not_affiliate: "affiliate.status.notAffiliate",
  active: "affiliate.status.active",
  suspended: "affiliate.status.suspended",
  disabled: "affiliate.status.disabled",
};

function AffiliatePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const dashboardFn = useServerFn(getMyAffiliateDashboard);
  const dashboardQuery = useQuery({
    queryKey: ["affiliate", "dashboard"],
    queryFn: () => dashboardFn(),
  });

  const joinFn = useServerFn(joinAffiliateProgram);
  const [joining, setJoining] = useState(false);

  async function handleJoin() {
    setJoining(true);
    try {
      const result = await joinFn();
      if (!result.ok) {
        toast.error(t(`affiliate.joinError.${result.reason}`, t("common.errorGeneric")));
        return;
      }
      toast.success(t("affiliate.joined"));
      await qc.invalidateQueries({ queryKey: ["affiliate"] });
    } finally {
      setJoining(false);
    }
  }

  const data = dashboardQuery.data;

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("auth.backToDashboard")}
        </Link>

        <header className="mt-4 flex items-center gap-3">
          <DashboardMobileNav />
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1D6BF3]/10 text-[#1D6BF3]">
            <Handshake className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("affiliate.title")}</h1>
            <p className="text-sm text-gray-500">{t("affiliate.subtitle")}</p>
          </div>
        </header>

        {dashboardQuery.isLoading ? (
          <div className="mt-6 space-y-4">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : data?.status !== "active" ? (
          <section className="mt-6 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-100">
            {data?.status === "suspended" || data?.status === "disabled" ? (
              <p className="text-sm text-gray-700">{t(STATUS_LABEL_KEY[data.status])}</p>
            ) : (
              <>
                <p className="text-sm text-gray-700">{t("affiliate.joinDescription")}</p>
                <button
                  type="button"
                  disabled={joining}
                  onClick={() => void handleJoin()}
                  className="mt-4 rounded-lg bg-[#1D6BF3] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {t("affiliate.joinCta")}
                </button>
              </>
            )}
          </section>
        ) : (
          <>
            <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                icon={MousePointerClick}
                value={data.clicksCount}
                label={t("affiliate.clicks")}
              />
              <StatCard
                icon={Wallet}
                value={`${data.conversions.approvedAmount.toFixed(2)} ${data.conversions.currency}`}
                label={t("affiliate.approvedBalance")}
              />
              <StatCard
                icon={Wallet}
                value={`${data.conversions.pendingAmount.toFixed(2)} ${data.conversions.currency}`}
                label={t("affiliate.pendingBalance")}
              />
              <StatCard
                icon={Wallet}
                value={`${data.conversions.paidAmount.toFixed(2)} ${data.conversions.currency}`}
                label={t("affiliate.paidTotal")}
              />
            </section>

            <section className="mt-4 rounded-2xl bg-white p-4 text-sm text-gray-600 shadow-sm ring-1 ring-gray-100">
              {t("affiliate.thresholdInfo", {
                threshold: data.payoutThreshold,
                currency: data.conversions.currency,
              })}
              {data.nextPayout && (
                <p className="mt-1 text-xs text-gray-400">
                  {t("affiliate.nextPayout", {
                    amount: Number(data.nextPayout.amount).toFixed(2),
                    currency: data.conversions.currency,
                    status: t(`affiliate.payoutStatus.${data.nextPayout.status}`),
                  })}
                </p>
              )}
            </section>

            <AffiliateCatalog />

            <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">
                {t("affiliate.recentConversions")}
              </h2>
              {data.recentConversions.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">{t("affiliate.noConversions")}</p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-100">
                  {data.recentConversions.map((c) => (
                    <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="min-w-0 truncate">{c.offerTitle}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-medium">
                          {c.commissionAmount.toFixed(2)} {c.currency}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            c.status === "paid"
                              ? "bg-emerald-100 text-emerald-700"
                              : c.status === "approved"
                                ? "bg-blue-100 text-blue-700"
                                : c.status === "reversed"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {t(`affiliate.conversionStatus.${c.status}`)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function StatCard({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Wallet;
  value: string | number;
  label: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-gray-100">
      <p className="flex items-center justify-center gap-1 text-lg font-semibold">
        <Icon className="h-4 w-4 text-[#1D6BF3]" />
        {value}
      </p>
      <p className="mt-1 text-xs text-gray-500">{label}</p>
    </div>
  );
}

function AffiliateCatalog() {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.slice(0, 2) ?? "bs") as "bs" | "en" | "de";
  const catalogFn = useServerFn(getAffiliateCatalog);
  const catalogQuery = useQuery({ queryKey: ["affiliate", "catalog"], queryFn: () => catalogFn() });
  const catalog = catalogQuery.data ?? [];

  if (!catalogQuery.isLoading && catalog.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
      <h2 className="text-sm font-semibold text-gray-900">{t("affiliate.catalogTitle")}</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {catalog.map((offer) => (
          <CatalogCard
            key={offer.id}
            offer={offer}
            title={
              offer[
                `title${lang === "bs" ? "Bs" : lang === "de" ? "De" : "En"}` as
                  "titleBs" | "titleEn" | "titleDe"
              ]
            }
          />
        ))}
      </div>
    </section>
  );
}

type AffiliateCatalogOffer = Awaited<ReturnType<typeof getAffiliateCatalog>>[number];

function CatalogCard({ offer, title }: { offer: AffiliateCatalogOffer; title: string }) {
  const { t } = useTranslation();
  const linkFn = useServerFn(getMyAffiliateLink);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePromote() {
    setLoading(true);
    try {
      const result = await linkFn({ data: { offerId: offer.id } });
      if (result.ok && result.code) {
        setCode(result.code);
      } else {
        toast.error(t("common.errorGeneric"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!code) return;
    const url = `${window.location.origin}/r/${code}`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        return;
      }
    }
    await navigator.clipboard.writeText(url);
    toast.success(t("share.linkCopied"));
  }

  return (
    <div className="rounded-xl border border-gray-100 p-4">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-xs text-gray-500">
        {offer.commissionType === "percent"
          ? t("affiliate.commissionPercent", { rate: offer.commissionRate })
          : t("affiliate.commissionFixed", {
              amount: offer.commissionFixedAmount,
              currency: offer.currency,
            })}
      </p>
      {code ? (
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1D6BF3] py-2 text-xs font-medium text-white"
        >
          <Link2 className="h-3.5 w-3.5" />
          {t("affiliate.copyLink")}
        </button>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={() => void handlePromote()}
          className="mt-3 w-full rounded-lg border border-gray-200 py-2 text-xs font-medium text-gray-700 disabled:opacity-50"
        >
          {t("affiliate.promote")}
        </button>
      )}
    </div>
  );
}
