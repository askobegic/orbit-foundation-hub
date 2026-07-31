import { createFileRoute } from "@tanstack/react-router";

import { addMonthsIso, writeAuditLog } from "@/lib/admin.server";
import { verifyPaymentReference } from "@/lib/payment-reference.server";

// Verifies the HMAC signature created by createPaymentReference
// (src/lib/payments.functions.ts) -- see PROJECT_AUDIT.md -> SE-7. A
// malformed or tampered custom_id (including the old, unsigned
// underscore-joined format) fails verification and is treated as "missing".
function parseCustom(v: string | null | undefined) {
  const verified = verifyPaymentReference(v);
  if (!verified) return { user_id: null, app_id: null, plan_id: null };
  return verified;
}

async function paypalBase() {
  const env = (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase();
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function verifyPayPalSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!id || !secret || !webhookId) return false;
  const base = await paypalBase();

  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) return false;
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const verifyRes = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: JSON.parse(rawBody),
    }),
  });
  if (!verifyRes.ok) return false;
  const j = (await verifyRes.json()) as { verification_status?: string };
  return j.verification_status === "SUCCESS";
}

export const Route = createFileRoute("/api/public/webhooks/paypal")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        const ok = await verifyPayPalSignature(request.headers, body);
        if (!ok) return new Response("Invalid signature", { status: 401 });

        const event = JSON.parse(body) as {
          event_type: string;
          resource: Record<string, unknown>;
        };
        if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
          return Response.json({ received: true });
        }

        const resource = event.resource as {
          id: string;
          custom_id?: string;
          amount?: { value?: string; currency_code?: string };
          invoice_id?: string;
        };
        const ref = parseCustom(resource.custom_id);
        if (!ref.user_id || !ref.app_id) {
          console.warn("PayPal webhook: missing, malformed, or unsigned custom_id", {
            capture_id: resource.id,
          });
          return Response.json({ received: true });
        }
        if (!ref.plan_id) {
          console.warn("PayPal webhook missing plan_id in custom_id", { capture_id: resource.id });
          return Response.json({ received: true, ignored: "missing_plan_id" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Idempotency: a redelivered webhook event must not create a second
        // payment record for the same capture. (paypal_payment_id has no
        // unique DB constraint, unlike Stripe's stripe_payment_id, so this
        // is an existence check rather than a DB-enforced guarantee.)
        const { data: existingPayment } = await supabaseAdmin
          .from("payments")
          .select("id")
          .eq("paypal_payment_id", resource.id)
          .maybeSingle();
        if (existingPayment) {
          return Response.json({ received: true, duplicate: true });
        }

        let months = 12;
        let currency = resource.amount?.currency_code ?? "EUR";
        let planPrice: number | null = null;
        if (ref.plan_id) {
          const { data: plan } = await supabaseAdmin
            .from("subscription_plans")
            .select("duration_months, currency, price, app_id, is_active")
            .eq("id", ref.plan_id)
            .maybeSingle();
          if (!plan) {
            console.warn("PayPal webhook: referenced plan not found", { plan_id: ref.plan_id });
            return Response.json({ received: true, ignored: "plan_not_found" });
          }
          {
            months = (plan as { duration_months: number }).duration_months;
            currency = (plan as { currency: string }).currency ?? currency;
            planPrice = Number((plan as { price: number | string }).price);
            const planAppId = (plan as { app_id: string }).app_id;
            const planActive = (plan as { is_active: boolean }).is_active;
            if (!planActive || planAppId !== ref.app_id) {
              console.warn("PayPal webhook: plan/app mismatch or inactive plan", {
                plan_id: ref.plan_id,
                app_id: ref.app_id,
              });
              return Response.json({ received: true, ignored: "plan_mismatch" });
            }
          }
        }
        const amount = Number(resource.amount?.value ?? 0);

        // Verify the actual captured amount/currency matches the referenced plan.
        // Blocks paying for a cheap plan while pointing custom_id at a pricier one.
        if (planPrice !== null) {
          const paidCurrency = (resource.amount?.currency_code ?? "").toUpperCase();
          const expectedCurrency = currency.toUpperCase();
          const amountMatches = Math.abs(amount - planPrice) < 0.01;
          const currencyMatches = paidCurrency === expectedCurrency;
          if (!amountMatches || !currencyMatches) {
            console.warn("PayPal webhook: paid amount/currency does not match plan", {
              plan_id: ref.plan_id,
              paid: amount,
              paidCurrency,
              expected: planPrice,
              expectedCurrency,
            });
            await writeAuditLog({
              userId: ref.user_id,
              action: "payment.paypal.plan_mismatch",
              entityType: "capture",
              entityId: resource.id,
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

        const { data: sub, error } = await supabaseAdmin
          .from("subscriptions")
          .upsert(
            {
              user_id: ref.user_id,
              app_id: ref.app_id,
              plan_id: ref.plan_id,
              status: "active",
              paypal_payment_id: resource.id,
              amount_paid: amount,
              currency,
              started_at: new Date().toISOString(),
              expires_at: addMonthsIso(months),
            },
            { onConflict: "user_id,app_id" },
          )
          .select("id")
          .single();
        if (error) return new Response("DB error", { status: 500 });

        // If this request lost a race against a concurrent redelivery of the
        // same capture, the payments.paypal_payment_id UNIQUE constraint
        // rejects this insert. Stop here rather than proceeding to send a
        // duplicate notification/audit-log/n8n event for the same payment.
        const { error: paymentErr } = await supabaseAdmin.from("payments").insert({
          user_id: ref.user_id,
          app_id: ref.app_id,
          subscription_id: (sub as { id: string }).id,
          paypal_payment_id: resource.id,
          amount,
          currency,
          status: "success",
          payment_method: "paypal",
        });
        if (paymentErr) {
          console.error("PayPal webhook: payments insert failed", paymentErr);
          return Response.json({ received: true, duplicate: true });
        }

        // Global Premium Visibility & Contact System: Premium status is
        // derived solely from hasAnyActivePremium() (live, from
        // `subscriptions`, upserted above) -- profiles.user_type is no
        // longer written here.

        const { error: notifyErr } = await supabaseAdmin.from("notifications").insert({
          user_id: ref.user_id,
          title_bs: "Uplata primljena",
          title_en: "Payment received",
          title_de: "Zahlung erhalten",
          message_bs: "Vaša premium pretplata je aktivirana.",
          message_en: "Your premium subscription is active.",
          message_de: "Ihr Premium-Abonnement ist aktiv.",
          type: "success",
          app_id: ref.app_id,
        });
        if (notifyErr) {
          console.error("PayPal webhook: notification insert failed", notifyErr);
        }

        await writeAuditLog({
          userId: ref.user_id,
          action: "payment.paypal.success",
          entityType: "subscription",
          entityId: (sub as { id: string }).id,
          newData: { paypal_id: resource.id, amount, currency },
        });

        const { sendN8nEvent } = await import("@/lib/n8n.server");
        await sendN8nEvent("payment_received", {
          provider: "paypal",
          user_id: ref.user_id,
          app_id: ref.app_id,
          subscription_id: (sub as { id: string }).id,
          amount,
          currency,
          paypal_id: resource.id,
        });
        await sendN8nEvent("premium_activated", {
          provider: "paypal",
          user_id: ref.user_id,
          app_id: ref.app_id,
          subscription_id: (sub as { id: string }).id,
        });

        return Response.json({ received: true });
      },
    },
  },
});
