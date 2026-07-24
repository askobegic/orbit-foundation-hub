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
        const ref = parseRef(session.client_reference_id ?? undefined);
        if (!ref.user_id || !ref.app_id) {
          console.warn("Stripe webhook missing user/app in client_reference_id");
          return Response.json({ received: true });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let planMonths = 12;
        let currency = (session.currency ?? "eur").toUpperCase();
        if (ref.plan_id) {
          const { data: plan } = await supabaseAdmin
            .from("subscription_plans")
            .select("duration_months, currency")
            .eq("id", ref.plan_id)
            .maybeSingle();
          if (plan) {
            planMonths = (plan as { duration_months: number }).duration_months;
            currency = (plan as { currency: string }).currency ?? currency;
          }
        }
        const amount = (session.amount_total ?? 0) / 100;

        const { data: sub, error: subErr } = await supabaseAdmin
          .from("subscriptions")
          .insert({
            user_id: ref.user_id,
            app_id: ref.app_id,
            plan_id: ref.plan_id,
            status: "active",
            stripe_payment_id: session.id,
            amount_paid: amount,
            currency,
            started_at: new Date().toISOString(),
            expires_at: addMonthsIso(planMonths),
          } as never)
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