import { createFileRoute } from "@tanstack/react-router";

import { addMonthsIso, writeAuditLog } from "@/lib/admin.server";

function parseCustom(v: string | null | undefined) {
  if (!v) return { user_id: null, app_id: null, plan_id: null };
  const [user_id, app_id, plan_id] = v.split("_");
  return { user_id: user_id ?? null, app_id: app_id ?? null, plan_id: plan_id ?? null };
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
        if (!ref.user_id || !ref.app_id) return Response.json({ received: true });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let months = 12;
        let currency = resource.amount?.currency_code ?? "EUR";
        if (ref.plan_id) {
          const { data: plan } = await supabaseAdmin
            .from("subscription_plans")
            .select("duration_months, currency")
            .eq("id", ref.plan_id)
            .maybeSingle();
          if (plan) {
            months = (plan as { duration_months: number }).duration_months;
            currency = (plan as { currency: string }).currency ?? currency;
          }
        }
        const amount = Number(resource.amount?.value ?? 0);

        const { data: sub, error } = await supabaseAdmin
          .from("subscriptions")
          .insert({
            user_id: ref.user_id,
            app_id: ref.app_id,
            plan_id: ref.plan_id,
            status: "active",
            paypal_payment_id: resource.id,
            amount_paid: amount,
            currency,
            started_at: new Date().toISOString(),
            expires_at: addMonthsIso(months),
          } as never)
          .select("id")
          .single();
        if (error) return new Response("DB error", { status: 500 });

        await supabaseAdmin.from("payments").insert({
          user_id: ref.user_id,
          app_id: ref.app_id,
          subscription_id: (sub as { id: string }).id,
          paypal_payment_id: resource.id,
          amount,
          currency,
          status: "success",
          payment_method: "paypal",
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
          action: "payment.paypal.success",
          entityType: "subscription",
          entityId: (sub as { id: string }).id,
          newData: { paypal_id: resource.id, amount, currency },
        });

        return Response.json({ received: true });
      },
    },
  },
});