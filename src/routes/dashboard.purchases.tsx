// Priority 8.11/8.12: Unified Products & Purchases -- the one Dashboard
// section covering the complete purchase/payment history across the
// ecosystem, including Advertising campaign purchases (Priority 8.12 --
// Advertising's own administration and campaign management,
// /dashboard/advertising, /admin/advertising, stay entirely separate; only
// this page's payment history was widened to include them, since a
// successful campaign purchase is still a purchase). Evolves (replaces)
// the earlier /dashboard/subscriptions page and the Dashboard's separate
// "Payment History" widget preview, combining both into one page rather
// than two disconnected views of the same underlying data. No new tables:
// `subscriptions` (Product entitlements) and `payments` (the provider
// transaction ledger for both Products and Advertising campaigns --
// `payments.subscription_id`/`payments.campaign_id` already distinguish
// the two) already carry everything this page shows -- see
// PROJECT_KNOWLEDGE.md -> Products & Purchases.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Crown, Receipt } from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { effectiveSubscriptionStatus } from "@/lib/subscription";
import type {
  ApplicationRow,
  PaymentRow,
  SubscriptionPlanRow,
  SubscriptionRow,
} from "@/types/database";

export const Route = createFileRoute("/dashboard/purchases")({
  head: () => ({
    meta: [
      { title: "Purchases — Core Platform" },
      { name: "description", content: "Your complete purchase history across the ecosystem." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <PurchasesPage />
    </ProtectedRoute>
  ),
});

type SubRow = SubscriptionRow & {
  plan: SubscriptionPlanRow | null;
  app: ApplicationRow | null;
};

function PurchasesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const subsQ = useQuery({
    queryKey: ["my-purchases", "products", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*, plan:subscription_plans(*), app:applications(*)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SubRow[];
    },
  });

  // Every successful payment, regardless of source -- Product (subscription/
  // promotion/one-time) or Advertising campaign -- is still a purchase, so
  // this is the one complete payment history, not filtered by source.
  // Advertising's own administration and campaign management
  // (/dashboard/advertising, /admin/advertising) remain entirely separate;
  // only this page's read-only history was widened to include it.
  const paymentsQ = useQuery({
    queryKey: ["my-purchases", "payments", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*, app:applications(*), campaign:ad_campaigns(title)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as (PaymentRow & {
        app: ApplicationRow | null;
        campaign: { title: string } | null;
      })[];
    },
  });

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <Link
          to="/dashboard"
          className="mb-6 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("auth.backToDashboard")}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">{t("purchases.title")}</h1>
        <p className="mb-6 text-sm text-gray-500">{t("purchases.subtitle")}</p>

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">{t("purchases.products")}</h2>
          {subsQ.isLoading ? (
            <p className="text-sm text-gray-500">{t("pricing.loading")}</p>
          ) : (subsQ.data?.length ?? 0) === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-100">
              <p className="text-sm text-gray-600">{t("purchases.noProducts")}</p>
              <Link
                to="/pricing"
                className="mt-4 inline-block rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white"
              >
                {t("dashboard.upgrade")}
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {subsQ.data!.map((s) => {
                const status = effectiveSubscriptionStatus(s);
                const productType = s.plan?.product_type ?? "subscription";
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-semibold text-white"
                        style={{ backgroundColor: s.app?.primary_color ?? "#1D6BF3" }}
                      >
                        <Crown className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">
                          {s.app?.name ?? t("dashboard.premium")} · {s.plan?.name ?? ""}
                        </p>
                        <p className="text-xs text-gray-500">
                          {t(`purchases.type.${productType}`)} ·{" "}
                          {t("dashboard.validUntil")}:{" "}
                          {new Date(s.expires_at).toLocaleDateString(i18n.language)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        status === "active"
                          ? "bg-emerald-100 text-emerald-700"
                          : status === "pending"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {t(`subscription.status.${status}`)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">{t("purchases.paymentHistory")}</h2>
          {paymentsQ.isLoading ? (
            <p className="text-sm text-gray-500">{t("pricing.loading")}</p>
          ) : (paymentsQ.data?.length ?? 0) === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-100">
              <p className="text-sm text-gray-600">{t("purchases.noPayments")}</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              {paymentsQ.data!.map((p) => {
                const transactionId = p.stripe_payment_id ?? p.paypal_payment_id ?? null;
                const provider =
                  p.payment_method === "stripe" ? "Stripe" : p.payment_method === "paypal" ? "PayPal" : t("purchases.adminGrant");
                const sourceLabel = p.campaign_id
                  ? `${t("purchases.advertisingCampaign")}${p.campaign?.title ? `: ${p.campaign.title}` : ""}`
                  : (p.app?.name ?? "");
                const appPrefix = p.campaign_id && p.app?.name ? `${p.app.name} · ` : "";
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                    <div className="flex items-center gap-3">
                      <Receipt className="h-4 w-4 shrink-0 text-gray-400" />
                      <div>
                        <p className="font-medium">
                          {appPrefix}
                          {sourceLabel} · {p.amount.toFixed(2)} {p.currency}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(p.created_at).toLocaleDateString(i18n.language)} · {t("purchases.provider")}:{" "}
                          {provider}
                          {transactionId ? ` · ${t("purchases.transactionId")}: ${transactionId}` : ""}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        p.status === "success"
                          ? "bg-emerald-100 text-emerald-700"
                          : p.status === "pending"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {p.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
