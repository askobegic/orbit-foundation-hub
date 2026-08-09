import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";

import { addMonthsIso, writeAuditLog } from "@/lib/admin.server";
import { activateCampaignFromPurchase } from "@/lib/advertising.server";
import { verifyCampaignReference, verifyPaymentReference } from "@/lib/payment-reference.server";
import { clientIp, isRateLimited } from "@/lib/rate-limit.server";

// Verifies the HMAC signature created by createPaymentReference
// (src/lib/payments.functions.ts) -- see PROJECT_AUDIT.md -> SE-7. A
// malformed or tampered client_reference_id (including the old, unsigned
// three-segment format) fails verification and is treated as "missing".
function parseRef(ref: string | null | undefined): {
  user_id: string | null;
  app_id: string | null;
  plan_id: string | null;
} {
  const verified = verifyPaymentReference(ref);
  if (!verified) return { user_id: null, app_id: null, plan_id: null };
  return verified;
}

export const Route = createFileRoute("/api/public/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Priority 11 security audit: defense-in-depth against a request
        // flood, even though signature verification below already rejects
        // invalid deliveries cheaply. 60/min per IP is generous for
        // legitimate Stripe webhook delivery volume.
        if (isRateLimited(`webhook-stripe:${clientIp(request)}`, 60, 60 * 1000)) {
          return new Response("Too Many Requests", { status: 429 });
        }
        const secret = process.env.STRIPE_SECRET_KEY;
        const whsec = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret || !whsec) return new Response("Not configured", { status: 500 });

        // Pinned API version predates the installed `stripe` SDK's typed
        // literal ("2026-06-24.dahlia") -- an as-never cast here is
        // deliberate, not Supabase-type-related: changing the pinned
        // version is a payment-webhook behavior decision, out of scope for
        // this pass. Flagged separately rather than silently upgraded.
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

        // Refund: revoke the entitlement granted by the original payment.
        // Matched via payment_intent, since that's what this event carries --
        // not the Checkout Session id stored in stripe_payment_id, which is
        // why fulfillment now also stores stripe_payment_intent_id (see the
        // payments insert below).
        //
        // Disputes/chargebacks (charge.dispute.created) are deliberately not
        // handled here -- a dispute is not the same outcome as a refund (the
        // merchant can still win it), and payments.status has no 'disputed'
        // value. Mapping a dispute to status='refunded' would conflate two
        // different states and leave no path back to restored access if the
        // dispute is won. Left for a later phase that introduces a proper
        // disputed state.
        if (event.type === "charge.refunded") {
          const object = event.data.object as { payment_intent: string | { id: string } | null };
          const paymentIntentId =
            typeof object.payment_intent === "string"
              ? object.payment_intent
              : (object.payment_intent?.id ?? null);
          if (!paymentIntentId) {
            return Response.json({ received: true });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: payment } = await supabaseAdmin
            .from("payments")
            .select("id, user_id, subscription_id, campaign_id, status")
            .eq("stripe_payment_intent_id", paymentIntentId)
            .maybeSingle();
          if (!payment) {
            console.warn("Stripe webhook: refund for unmatched payment_intent", {
              paymentIntentId,
            });
            return Response.json({ received: true, ignored: "payment_not_found" });
          }

          const paymentRow = payment as {
            id: string;
            user_id: string | null;
            subscription_id: string | null;
            campaign_id: string | null;
            status: string;
          };
          if (paymentRow.status === "refunded") {
            return Response.json({ received: true, duplicate: true });
          }

          const { error: refundPaymentErr } = await supabaseAdmin
            .from("payments")
            .update({ status: "refunded" })
            .eq("id", paymentRow.id);
          if (refundPaymentErr) {
            console.error("Stripe webhook: payments refund update failed", refundPaymentErr);
          }

          if (paymentRow.subscription_id) {
            const { error: cancelSubErr } = await supabaseAdmin
              .from("subscriptions")
              .update({ status: "cancelled", expires_at: new Date().toISOString() })
              .eq("id", paymentRow.subscription_id);
            if (cancelSubErr) {
              console.error("Stripe webhook: subscription cancel on refund failed", cancelSubErr);
            }
          }

          if (paymentRow.campaign_id) {
            const { error: cancelCampaignErr } = await supabaseAdmin
              .from("ad_campaigns")
              .update({ status: "cancelled", updated_at: new Date().toISOString() })
              .eq("id", paymentRow.campaign_id);
            if (cancelCampaignErr) {
              console.error("Stripe webhook: campaign cancel on refund failed", cancelCampaignErr);
            }
          }

          // Global Premium Visibility & Contact System: Premium status is
          // derived solely from hasAnyActivePremium() (live, from
          // `subscriptions`) -- profiles.user_type is no longer written or
          // read as a Premium signal anywhere, so there is nothing left to
          // revert here once the subscription above is cancelled.

          await writeAuditLog({
            userId: paymentRow.user_id,
            action: "payment.stripe.refunded",
            entityType: "payment",
            entityId: paymentRow.id,
            newData: { payment_intent: paymentIntentId },
          });

          return Response.json({ received: true });
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

        // Priority 8.4: Advertising campaign checkout uses its own signed
        // reference shape (a leading "campaign" tag -- see
        // payment-reference.server.ts), so it can never be confused with a
        // subscription reference. Checked first and returns early; the
        // subscription flow below is otherwise completely unchanged.
        const campaignRef = verifyCampaignReference(session.client_reference_id ?? undefined);
        if (campaignRef) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: existingPayment } = await supabaseAdmin
            .from("payments")
            .select("id")
            .eq("stripe_payment_id", session.id)
            .maybeSingle();
          if (existingPayment) {
            return Response.json({ received: true, duplicate: true });
          }

          const amount = (session.amount_total ?? 0) / 100;
          const currency = (session.currency ?? "eur").toUpperCase();

          const result = await activateCampaignFromPurchase({
            campaignId: campaignRef.campaign_id,
            userId: campaignRef.user_id,
            appId: campaignRef.app_id,
            paidAmount: amount,
            paidCurrency: currency,
          });
          if (!result.ok) {
            console.warn("Stripe webhook: campaign activation failed", {
              session_id: session.id,
              reason: result.reason,
            });
            return Response.json({ received: true, ignored: result.reason });
          }

          const { error: insertPaymentErr } = await supabaseAdmin.from("payments").insert({
            user_id: campaignRef.user_id,
            app_id: campaignRef.app_id,
            campaign_id: campaignRef.campaign_id,
            stripe_payment_id: session.id,
            stripe_payment_intent_id:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : (session.payment_intent?.id ?? null),
            amount,
            currency,
            status: "success",
            payment_method: "stripe",
            invoice_url: session.invoice ? String(session.invoice) : null,
          });
          if (insertPaymentErr) {
            console.error("Stripe webhook: campaign payment insert failed", insertPaymentErr);
          }

          await writeAuditLog({
            userId: campaignRef.user_id,
            action: "payment.stripe.campaign_success",
            entityType: "ad_campaign",
            entityId: campaignRef.campaign_id,
            newData: { session_id: session.id, amount, currency, creditApplied: result.creditApplied },
          });

          const { grantRewardAction } = await import("@/lib/rewards.server");
          await grantRewardAction({
            userId: campaignRef.user_id,
            action: "advertising_purchase",
            resourceType: "ad_campaign",
            resourceId: campaignRef.campaign_id,
            sourceAppId: campaignRef.app_id,
          });

          return Response.json({ received: true });
        }

        const ref = parseRef(session.client_reference_id ?? undefined);
        if (!ref.user_id || !ref.app_id) {
          console.warn("Stripe webhook: missing, malformed, or unsigned client_reference_id", {
            session_id: session.id,
          });
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

        // Checked before the upsert below so we can tell first purchase
        // apart from a renewal for Rewards & Loyalty (reward_action_rules
        // has separate entries for premium_purchase/premium_renewal) --
        // the upsert itself reuses the same row either way.
        const { data: existingSub } = await supabaseAdmin
          .from("subscriptions")
          .select("id")
          .eq("user_id", ref.user_id)
          .eq("app_id", ref.app_id)
          .maybeSingle();
        const isRenewal = !!existingSub;

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
            },
            { onConflict: "user_id,app_id" },
          )
          .select("id")
          .single();
        if (subErr) {
          console.error(subErr);
          return new Response("DB error", { status: 500 });
        }

        const { error: insertPaymentErr } = await supabaseAdmin.from("payments").insert({
          user_id: ref.user_id,
          app_id: ref.app_id,
          subscription_id: (sub as { id: string }).id,
          stripe_payment_id: session.id,
          stripe_payment_intent_id:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : (session.payment_intent?.id ?? null),
          amount,
          currency,
          status: "success",
          payment_method: "stripe",
          invoice_url: session.invoice ? String(session.invoice) : null,
        });
        if (insertPaymentErr) {
          console.error("Stripe webhook: payments insert failed", insertPaymentErr);
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
          console.error("Stripe webhook: notification insert failed", notifyErr);
        }

        await writeAuditLog({
          userId: ref.user_id,
          action: "payment.stripe.success",
          entityType: "subscription",
          entityId: (sub as { id: string }).id,
          newData: { session_id: session.id, amount, currency },
        });

        const { grantRewardAction, recordPremiumReferralIfApplicable } = await import(
          "@/lib/rewards.server"
        );
        await grantRewardAction({
          userId: ref.user_id,
          action: isRenewal ? "premium_renewal" : "premium_purchase",
          resourceType: "subscription",
          resourceId: (sub as { id: string }).id,
          sourceAppId: ref.app_id,
        });
        await recordPremiumReferralIfApplicable({
          userId: ref.user_id,
          subscriptionId: (sub as { id: string }).id,
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
