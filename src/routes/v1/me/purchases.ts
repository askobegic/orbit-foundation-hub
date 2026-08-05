// API_CONTRACT.md §12 -- GET /v1/me/purchases. The one unified purchase-
// history endpoint -- same two queries dashboard.purchases.tsx already
// runs (subscriptions for entitlements, payments for the complete
// transaction ledger including Advertising campaign payments).
import { createFileRoute } from "@tanstack/react-router";

import { effectiveSubscriptionStatus } from "@/lib/subscription";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";
import type {
  ApplicationRow,
  PaymentRow,
  SubscriptionPlanRow,
  SubscriptionRow,
} from "@/types/database";

type SubRow = SubscriptionRow & { plan: SubscriptionPlanRow | null; app: ApplicationRow | null };
type PaymentJoinRow = PaymentRow & {
  app: { name: string } | null;
  campaign: { title: string } | null;
};

export const Route = createFileRoute("/v1/me/purchases")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const url = new URL(request.url);
        const statusFilter = url.searchParams.get("status");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const [{ data: subs, error: subsErr }, { data: payments, error: paymentsErr }] =
          await Promise.all([
            supabaseAdmin
              .from("subscriptions")
              .select("*, plan:subscription_plans(*), app:applications(*)")
              .eq("user_id", ctx.userId)
              .order("created_at", { ascending: false }),
            supabaseAdmin
              .from("payments")
              .select("*, app:applications(name), campaign:ad_campaigns(title)")
              .eq("user_id", ctx.userId)
              .order("created_at", { ascending: false }),
          ]);
        if (subsErr) throw new Error(subsErr.message);
        if (paymentsErr) throw new Error(paymentsErr.message);

        const subRows = (subs ?? []) as unknown as SubRow[];
        const paymentRows = (payments ?? []) as unknown as PaymentJoinRow[];

        const products = subRows
          .map((s) => ({
            id: s.id,
            appId: s.app_id,
            appName: s.app?.name ?? null,
            productName: s.plan?.name ?? null,
            productType: s.plan?.product_type ?? "subscription",
            status: effectiveSubscriptionStatus(s),
            startedAt: s.started_at,
            expiresAt: s.expires_at,
          }))
          .filter((p) => !statusFilter || p.status === statusFilter);

        const paymentList = paymentRows.map((p) => ({
          id: p.id,
          appId: p.app_id,
          appName: p.app?.name ?? null,
          source: p.campaign_id ? "advertising" : "product",
          ...(p.campaign_id
            ? { campaignId: p.campaign_id, campaignTitle: p.campaign?.title ?? null }
            : {}),
          amount: Number(p.amount),
          currency: p.currency,
          provider: p.payment_method,
          transactionId: p.stripe_payment_id ?? p.paypal_payment_id ?? null,
          status: p.status,
          createdAt: p.created_at,
        }));

        return apiData({ products, payments: paymentList });
      }),
    },
  },
});
