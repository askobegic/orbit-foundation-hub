import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";

import { addMonthsIso, writeAuditLog } from "@/lib/admin.server";

function parseRef(ref: string | null | undefined): {
  user_id: string | null;
  app_id: string | null;
  plan_id: string | null;
} {
  if (!ref) return { user_id: null, app_id: null, plan_id: null };
  const parts = ref.split("__");
  return {
    user_id: parts[0] ?? null,
    app_id: parts[1] ?? null,
    plan_id: parts[2] ?? null,
  };
}

export const Route = createFileRoute("/api/public/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_SECRET_KEY;
        const whsec = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret || !whsec) return new Response("Not configured", { status: 500 });

        const stripe = new Stripe(secret, { apiVersion: "2024-11-20.acacia" as never });
        const sig = request.headers.get("stripe-signature");
        if (!sig) return new Response("Missing signature", { status: 400 });
        const body = await request.text();

        let event: Stripe.Event;
        try {
          event = await stripe.webhooks.constructEventAsync(body, sig, whsec);
        } catch (err) {
          console.error("Stripe signature verification failed", err);
          return new Response("Invalid signature", { status: 401 });
        }

        if (event.type !== "checkout.session.completed") {
          return Response.json({ received: true });
        }

        const session = event.data.object as Stripe.Checkout.Session;

        // Only fulfill sessions with confirmed payment. checkout.session.completed
        // also fires for delayed/asynchronous payment methods before funds are
        // actually confirmed (payment_status "unpaid"); those are fulfilled later
        // via checkout.session.async_payment_succeeded, which is not yet handled.
        if (session.payment_status !== "paid") {
          console.warn("Stripe webhook: session not yet paid", {
            session_id: session.id,
            payment_status: session.payment_status,
          });
          return Response.json({ received: true, ignored: "not_paid" });
        }

        const ref = parseRef(session.client_reference_id ?? undefined);
        if (!ref.user_id || !ref.app_id) {
          console.warn("Stripe webhook missing user/app in client_reference_id");
          return Response.json({ received: true });
        }
        if (!ref.plan_id) {
          console.warn("Stripe webhook missing plan_id in client_reference_id", {
            session_id: session.id,
          });
          return Response.json({ received: true, ignored: "missing_plan_id" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Idempotency: a redelivered webhook event must not create a second
        // payment record for the same checkout session.
        const { data: existingPayment } = await supabaseAdmin
          .from("payments")
          .select("id")
          .eq("stripe_payment_id", session.id)
          .maybeSingle();
        if (existingPayment) {
          return Response.json({ received: true, duplicate: true });
        }

        let planMonths = 12;
        let currency = (session.currency ?? "eur").toUpperCase();
        let planPrice: number | null = null;
        if (ref.plan_id) {
          const { data: plan } = await supabaseAdmin
            .from("subscription_plans")
            .select("duration_months, currency, price, app_id, is_active")
            .eq("id", ref.plan_id)
            .maybeSingle();
          if (!plan) {
            console.warn("Stripe webhook: referenced plan not found", { plan_id: ref.plan_id });
            return Response.json({ received: true, ignored: "plan_not_found" });
          }
          {
            planMonths = (plan as { duration_months: number }).duration_months;
            currency = (plan as { currency: string }).currency ?? currency;
            planPrice = Number((plan as { price: number | string }).price);
            const planAppId = (plan as { app_id: string }).app_id;
            const planActive = (plan as { is_active: boolean }).is_active;
            if (!planActive || planAppId !== ref.app_id) {
              console.warn("Stripe webhook: plan/app mismatch or inactive plan", {
                plan_id: ref.plan_id,
                app_id: ref.app_id,
              });
              return Response.json({ received: true, ignored: "plan_mismatch" });
            }
          }
        }
        const amount = (session.amount_total ?? 0) / 100;

        // Verify the amount actually paid matches the referenced plan's price/currency.
        // Prevents a user from paying via a cheap plan link while pointing the
        // client_reference_id at a longer/more expensive plan.
        if (planPrice !== null) {
          const paidCurrency = (session.currency ?? "").toUpperCase();
          const expectedCurrency = currency.toUpperCase();
          const amountMatches = Math.abs(amount - planPrice) < 0.01;
          const currencyMatches = paidCurrency === expectedCurrency;
          if (!amountMatches || !currencyMatches) {
            console.warn("Stripe webhook: paid amount/currency does not match plan", {
              plan_id: ref.plan_id,
              paid: amount,
              paidCurrency,
              expected: planPrice,
              expectedCurrency,
            });
            await writeAuditLog({
              userId: ref.user_id,
              action: "payment.stripe.plan_mismatch",
              entityType: "checkout_session",
              entityId: session.id,
              newData: {
                plan_id: ref.plan_id,
                paid: amount,
                paidCurrency,
                expected: planPrice,
                expectedCurrency,
              },
            });
            return Response.json({ received: true, ignored: "amount_mismatch" });
          }
        }

        const { data: sub, error: subErr } = await supabaseAdmin
          .from("subscriptions")
          .upsert(
            {
              user_id: ref.user_id,
              app_id: ref.app_id,
              plan_id: ref.plan_id,
              status: "active",
              stripe_payment_id: session.id,
              amount_paid: amount,
              currency,
              started_at: new Date().toISOString(),
              expires_at: addMonthsIso(planMonths),
            } as never,
            { onConflict: "user_id,app_id" },
          )
          .select("id")
          .single();
        if (subErr) {
          console.error(subErr);
          return new Response("DB error", { status: 500 });
        }

        await supabaseAdmin.from("payments").insert({
          user_id: ref.user_id,
          app_id: ref.app_id,
          subscription_id: (sub as { id: string }).id,
          stripe_payment_id: session.id,
          amount,
          currency,
          status: "success",
          payment_method: "stripe",
          invoice_url: session.invoice ? String(session.invoice) : null,
        } as never);

        await supabaseAdmin
          .from("profiles")
          .update({ user_type: "premium" } as never)
          .eq("id", ref.user_id);

        await supabaseAdmin.from("notifications").insert({
          user_id: ref.user_id,
          title_bs: "Uplata primljena",
          title_en: "Payment received",
          title_de: "Zahlung erhalten",
          message_bs: "Vaša premium pretplata je aktivirana.",
          message_en: "Your premium subscription is active.",
          message_de: "Ihr Premium-Abonnement ist aktiv.",
          type: "success",
          app_id: ref.app_id,
        } as never);

        await writeAuditLog({
          userId: ref.user_id,
          action: "payment.stripe.success",
          entityType: "subscription",
          entityId: (sub as { id: string }).id,
          newData: { session_id: session.id, amount, currency },
        });

        const { sendN8nEvent } = await import("@/lib/n8n.server");
        await sendN8nEvent("payment_received", {
          provider: "stripe",
          user_id: ref.user_id,
          app_id: ref.app_id,
          subscription_id: (sub as { id: string }).id,
          amount,
          currency,
          session_id: session.id,
        });
        await sendN8nEvent("premium_activated", {
          provider: "stripe",
          user_id: ref.user_id,
          app_id: ref.app_id,
          subscription_id: (sub as { id: string }).id,
        });

        return Response.json({ received: true });
      },
    },
  },
});