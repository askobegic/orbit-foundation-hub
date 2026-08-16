import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Crown, ArrowLeft } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { createPaymentReference } from "@/lib/payments.functions";
import type { ApplicationRow, SubscriptionPlanRow } from "@/types/database";

export const Route = createFileRoute("/pricing")({
  validateSearch: (search: Record<string, unknown>) => ({
    app: typeof search.app === "string" ? search.app : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Pricing — Core Platform" },
      { name: "description", content: "Choose a Premium plan for each application." },
      { property: "og:title", content: "Pricing — Core Platform" },
      { property: "og:description", content: "Choose a Premium plan for each application." },
    ],
  }),
  component: PricingPage,
});

function appendParams(url: string, params: Record<string, string>) {
  try {
    const u = new URL(url);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  } catch {
    return url;
  }
}

function PricingPage() {
  const { t, i18n } = useTranslation();
  const { user, profile } = useAuth();
  const { app: appSlugFromUrl } = Route.useSearch();
  const lang = (i18n.language?.slice(0, 2) ?? "bs") as "bs" | "en" | "de";
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [payingPlanId, setPayingPlanId] = useState<string | null>(null);
  const createReference = useServerFn(createPaymentReference);

  // /pricing is the actual purchase surface, not a status display -- unlike
  // the Dashboard "My Applications" widget (which also shows coming_soon,
  // disabled, for visibility), an application must be fully `active` before
  // it can be offered for purchase here. draft/coming_soon/archived
  // applications are excluded at the query level, matching the same
  // visibility gate already used elsewhere (DashboardPage.tsx's appsQuery),
  // not a second filtering convention.
  const appsQuery = useQuery({
    queryKey: ["pricing", "apps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("applications")
        .select("*")
        .eq("visibility", "active")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ApplicationRow[];
    },
  });

  const appFromSlug = appSlugFromUrl
    ? (appsQuery.data?.find((a) => a.slug === appSlugFromUrl)?.id ?? null)
    : null;
  const activeAppId = selectedApp ?? appFromSlug ?? appsQuery.data?.[0]?.id ?? null;

  const plansQuery = useQuery({
    queryKey: ["pricing", "plans", activeAppId],
    enabled: !!activeAppId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .eq("app_id", activeAppId!)
        .eq("is_active", true)
        .order("duration_months", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SubscriptionPlanRow[];
    },
  });

  const activeApp = useMemo(
    () => appsQuery.data?.find((a) => a.id === activeAppId) ?? null,
    [appsQuery.data, activeAppId],
  );

  // The (user_id, app_id, plan_id) reference is signed server-side
  // (createPaymentReference) rather than built as a plain client-side string
  // -- see PROJECT_AUDIT.md -> SE-7. Both webhooks reject an unsigned or
  // tampered reference before granting any entitlement.
  async function handlePay(plan: SubscriptionPlanRow, provider: "stripe" | "paypal") {
    const link = provider === "stripe" ? plan.stripe_payment_link : plan.paypal_payment_link;
    if (!link || !user || !activeAppId) return;
    setPayingPlanId(plan.id);
    try {
      const { reference } = await createReference({
        data: { app_id: activeAppId, plan_id: plan.id },
      });
      const url =
        provider === "stripe"
          ? appendParams(link, {
              client_reference_id: reference,
              prefilled_email: user.email ?? "",
            })
          : appendParams(link, { custom: reference });
      window.location.href = url;
    } catch (err) {
      console.error("createPaymentReference failed", err);
      // Sponsored-requires-Listing pre-check (see createPaymentReference):
      // a specific, actionable message instead of the generic fallback.
      const message =
        err instanceof Error && err.message === "dependency_not_met"
          ? t("pricing.dependencyNotMet")
          : t("common.errorGeneric");
      toast.error(message);
      setPayingPlanId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("auth.backToDashboard")}
          </Link>
          <span className="min-w-0 truncate text-xs text-gray-500">
            {profile?.first_name ? `${profile.first_name} · ` : ""}
            {user?.email}
          </span>
        </div>

        <div className="text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#F59E0B] to-[#EF4444] px-3 py-1 text-xs font-semibold text-white">
            <Crown className="h-3 w-3" /> {t("pricing.premium")}
          </div>
          <h1 className="mt-3 text-3xl font-semibold text-gray-900">{t("pricing.title")}</h1>
          <p className="mt-2 text-sm text-gray-600">{t("pricing.subtitle")}</p>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {(appsQuery.data ?? []).map((app) => (
            <button
              key={app.id}
              onClick={() => setSelectedApp(app.id)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                activeAppId === app.id
                  ? "text-white shadow-sm"
                  : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
              }`}
              style={activeAppId === app.id ? { backgroundColor: app.primary_color } : undefined}
            >
              <span className="inline-flex items-center gap-2">
                {app.logo_url ? (
                  <img
                    src={app.logo_url}
                    alt=""
                    width={20}
                    height={20}
                    className="h-5 w-5 rounded object-cover"
                  />
                ) : (
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-semibold text-white"
                    style={{ backgroundColor: app.primary_color }}
                  >
                    {app.name.slice(0, 1)}
                  </span>
                )}
                {app.name}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {plansQuery.isLoading && (
            <p className="col-span-full text-center text-sm text-gray-500">
              {t("pricing.loading")}
            </p>
          )}
          {plansQuery.data?.length === 0 && (
            <p className="col-span-full text-center text-sm text-gray-500">
              {t("pricing.noPlans")}
            </p>
          )}
          {(plansQuery.data ?? []).map((plan) => {
            const features =
              (plan[`features_${lang}` as const] as string[]) ?? plan.features_en ?? [];
            const canStripe = !!(plan.stripe_payment_link && user && activeAppId);
            const canPaypal = !!(plan.paypal_payment_link && user && activeAppId);
            const isPaying = payingPlanId === plan.id;
            const monthly = plan.duration_months
              ? (Number(plan.price) / plan.duration_months).toFixed(2)
              : "-";

            return (
              <div
                key={plan.id}
                className="flex flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {activeApp?.logo_url ? (
                      <img
                        src={activeApp.logo_url}
                        alt=""
                        width={24}
                        height={24}
                        className="h-6 w-6 rounded-lg object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-semibold text-white"
                        style={{ backgroundColor: activeApp?.primary_color ?? "#1D6BF3" }}
                      >
                        {activeApp?.name.slice(0, 1) ?? "A"}
                      </div>
                    )}
                    <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                    style={{
                      backgroundColor: activeApp?.primary_color ?? "#1D6BF3",
                    }}
                  >
                    {plan.duration_months} {t("pricing.months")}
                  </span>
                </div>
                <div className="mt-4">
                  <span className="text-3xl font-bold text-gray-900">
                    {Number(plan.price).toFixed(2)}
                  </span>
                  <span className="ml-1 text-sm text-gray-500">{plan.currency}</span>
                  <p className="mt-1 text-xs text-gray-500">
                    {monthly} {plan.currency}/{t("pricing.perMonth")}
                  </p>
                </div>
                <ul className="mt-6 flex-1 space-y-2 text-sm text-gray-700">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 space-y-2">
                  {canStripe ? (
                    <button
                      type="button"
                      disabled={isPaying}
                      onClick={() => void handlePay(plan, "stripe")}
                      className="block w-full rounded-lg bg-[#1D6BF3] px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-[#1858cf] disabled:opacity-60"
                    >
                      {isPaying ? t("common.loading") : t("pricing.payStripe")}
                    </button>
                  ) : (
                    <button
                      disabled
                      className="block w-full rounded-lg bg-gray-100 px-4 py-2.5 text-center text-sm text-gray-400"
                    >
                      {t("pricing.stripeUnavailable")}
                    </button>
                  )}
                  {canPaypal ? (
                    <button
                      type="button"
                      disabled={isPaying}
                      onClick={() => void handlePay(plan, "paypal")}
                      className="block w-full rounded-lg border border-[#F59E0B] px-4 py-2.5 text-center text-sm font-medium text-[#F59E0B] hover:bg-[#F59E0B]/10 disabled:opacity-60"
                    >
                      {isPaying ? t("common.loading") : t("pricing.payPaypal")}
                    </button>
                  ) : (
                    <button
                      disabled
                      className="block w-full rounded-lg border border-gray-200 px-4 py-2.5 text-center text-sm text-gray-400"
                    >
                      {t("pricing.paypalUnavailable")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {!user && (
          <p className="mt-10 text-center text-sm text-gray-500">
            <Link to="/login" className="text-[#1D6BF3] hover:underline">
              {t("auth.login")}
            </Link>{" "}
            {t("pricing.signInHint")}
          </p>
        )}
      </div>
    </main>
  );
}
