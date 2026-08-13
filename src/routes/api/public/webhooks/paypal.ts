import { createFileRoute } from "@tanstack/react-router";

import { addMonthsIso, writeAuditLog } from "@/lib/admin.server";
import { activateCampaignFromPurchase } from "@/lib/advertising.server";
import {
  verifyCampaignReference,
  verifyCouponReference,
  verifyPaymentReference,
} from "@/lib/payment-reference.server";
import { clientIp, isRateLimited } from "@/lib/rate-limit.server";

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
        // Priority 11 security audit: verifyPayPalSignature makes two
        // outbound HTTPS calls to PayPal on every delivery, valid or not,
        // before any rejection can happen -- a flood of garbage POSTs to
        // this public, unauthenticated endpoint forces the server to make
        // two PayPal API calls per request. Rejecting cheaply, before that
        // work runs, closes the resource-exhaustion angle; 60/min per IP is
        // generous for legitimate PayPal webhook delivery volume.
        if (isRateLimited(`webhook-paypal:${clientIp(request)}`, 60, 60 * 1000)) {
          return new Response("Too Many Requests", { status: 429 });
        }
        const body = await request.text();
        const ok = await verifyPayPalSignature(request.headers, body);
        if (!ok) return new Response("Invalid signature", { status: 401 });

        const event = JSON.parse(body) as {
          id: string;
          event_type: string;
          resource: Record<string, unknown>;
        };

        // Priority 16: refund handling -- previously absent entirely for
        // PayPal (Phase A audit finding). PAYMENT.CAPTURE.REFUNDED fires
        // once per discrete refund transaction (unlike Stripe's
        // cumulative amount_refunded), with the refund's own amount and a
        // "up" link back to the original capture -- see
        // https://developer.paypal.com/docs/api/payments/v2/#captures_refund.
        if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
          const refundResource = event.resource as {
            id: string;
            amount?: { value?: string; currency_code?: string };
            links?: { rel: string; href: string }[];
          };
          const upLink = (refundResource.links ?? []).find((l) => l.rel === "up");
          const captureId = upLink ? upLink.href.split("/").filter(Boolean).pop() : null;
          if (!captureId) {
            console.warn("PayPal webhook: refund with no resolvable capture id", {
              refund_id: refundResource.id,
            });
            return Response.json({ received: true, ignored: "capture_id_not_found" });
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: payment } = await supabaseAdmin
            .from("payments")
            .select("id, user_id, app_id, subscription_id, campaign_id, status")
            .eq("paypal_payment_id", captureId)
            .maybeSingle();
          if (!payment) {
            console.warn("PayPal webhook: refund for unmatched capture", { captureId });
            return Response.json({ received: true, ignored: "payment_not_found" });
          }
          const paymentRow = payment as {
            id: string;
            user_id: string | null;
            app_id: string | null;
            subscription_id: string | null;
            campaign_id: string | null;
            status: string;
          };

          // Each PAYMENT.CAPTURE.REFUNDED event reports ONE discrete
          // refund's own amount (not cumulative like Stripe), so it is
          // already the correct delta -- idempotency comes entirely from
          // this refund's own id as the reversal's dedupe_key.
          if (paymentRow.user_id) {
            const refundAmountEur = Number(refundResource.amount?.value ?? 0);
            if (refundAmountEur > 0) {
              const { reversePaymentPoints } = await import("@/lib/rewards.server");
              const reversal = await reversePaymentPoints({
                paymentId: paymentRow.id,
                userId: paymentRow.user_id,
                sourceAppId: paymentRow.app_id,
                refundedAmountEurNow: refundAmountEur,
                dedupeKey: `refund:paypal:${refundResource.id}`,
              });
              if (!reversal.ok) {
                console.error("PayPal webhook: point reversal failed", {
                  payment_id: paymentRow.id,
                  reason: reversal.reason,
                });
              }
            }
          }

          if (paymentRow.status !== "refunded") {
            const { error: refundPaymentErr } = await supabaseAdmin
              .from("payments")
              .update({ status: "refunded" })
              .eq("id", paymentRow.id);
            if (refundPaymentErr) {
              console.error("PayPal webhook: payments refund update failed", refundPaymentErr);
            }

            if (paymentRow.subscription_id) {
              const { error: cancelSubErr } = await supabaseAdmin
                .from("subscriptions")
                .update({ status: "cancelled", expires_at: new Date().toISOString() })
                .eq("id", paymentRow.subscription_id);
              if (cancelSubErr) {
                console.error("PayPal webhook: subscription cancel on refund failed", cancelSubErr);
              }
            }

            if (paymentRow.campaign_id) {
              const { error: cancelCampaignErr } = await supabaseAdmin
                .from("ad_campaigns")
                .update({ status: "cancelled", updated_at: new Date().toISOString() })
                .eq("id", paymentRow.campaign_id);
              if (cancelCampaignErr) {
                console.error("PayPal webhook: campaign cancel on refund failed", cancelCampaignErr);
              }
            }

            await writeAuditLog({
              userId: paymentRow.user_id,
              action: "payment.paypal.refunded",
              entityType: "payment",
              entityId: paymentRow.id,
              newData: { capture_id: captureId, refund_id: refundResource.id },
            });
          }

          return Response.json({ received: true });
        }

        if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
          return Response.json({ received: true });
        }

        const resource = event.resource as {
          id: string;
          custom_id?: string;
          amount?: { value?: string; currency_code?: string };
          invoice_id?: string;
        };
        // Priority 8.4: Advertising campaign checkout uses its own signed
        // reference shape -- see the matching branch in the Stripe webhook
        // for the full rationale. Checked first and returns early; the
        // subscription flow below is otherwise completely unchanged.
        const campaignRef = verifyCampaignReference(resource.custom_id);
        if (campaignRef) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: existingCampaignPayment } = await supabaseAdmin
            .from("payments")
            .select("id")
            .eq("paypal_payment_id", resource.id)
            .maybeSingle();
          if (existingCampaignPayment) {
            return Response.json({ received: true, duplicate: true });
          }

          const amount = Number(resource.amount?.value ?? 0);
          const currency = (resource.amount?.currency_code ?? "EUR").toUpperCase();

          const result = await activateCampaignFromPurchase({
            campaignId: campaignRef.campaign_id,
            userId: campaignRef.user_id,
            appId: campaignRef.app_id,
            paidAmount: amount,
            paidCurrency: currency,
          });
          if (!result.ok) {
            console.warn("PayPal webhook: campaign activation failed", {
              capture_id: resource.id,
              reason: result.reason,
            });
            return Response.json({ received: true, ignored: result.reason });
          }

          const { data: insertedCampaignPayment, error: campaignPaymentErr } = await supabaseAdmin
            .from("payments")
            .insert({
              user_id: campaignRef.user_id,
              app_id: campaignRef.app_id,
              campaign_id: campaignRef.campaign_id,
              paypal_payment_id: resource.id,
              amount,
              currency,
              status: "success",
              payment_method: "paypal",
            })
            .select("id")
            .single();
          if (campaignPaymentErr) {
            console.error("PayPal webhook: campaign payment insert failed", campaignPaymentErr);
            return Response.json({ received: true, duplicate: true });
          }

          await writeAuditLog({
            userId: campaignRef.user_id,
            action: "payment.paypal.campaign_success",
            entityType: "ad_campaign",
            entityId: campaignRef.campaign_id,
            newData: { paypal_id: resource.id, amount, currency, creditApplied: result.creditApplied },
          });

          // Priority 16: proportional financial points (EUR paid x 10).
          // Server-verified amount only. Non-EUR reported, not guessed.
          const { grantRewardAction } = await import("@/lib/rewards.server");
          if (currency.toUpperCase() === "EUR" && insertedCampaignPayment) {
            await grantRewardAction({
              userId: campaignRef.user_id,
              action: "advertising_purchase",
              resourceType: "payment",
              resourceId: insertedCampaignPayment.id,
              sourceAppId: campaignRef.app_id,
              amountEur: amount,
              dedupeKey: `payment:${insertedCampaignPayment.id}`,
            });
          } else if (insertedCampaignPayment) {
            console.warn("PayPal webhook: non-EUR campaign payment, proportional points not calculated", {
              payment_id: insertedCampaignPayment.id,
              currency,
            });
            await writeAuditLog({
              userId: campaignRef.user_id,
              action: "payment.paypal.non_eur_points_skipped",
              entityType: "payment",
              entityId: insertedCampaignPayment.id,
              newData: { currency, amount },
            });
          }

          return Response.json({ received: true });
        }

        // Priority 17: Public Coupons -- see the matching branch in the
        // Stripe webhook for the full rationale. Subscription-activation
        // logic below is completely unchanged either way.
        const couponRef = verifyCouponReference(resource.custom_id);
        const ref = couponRef ?? parseCustom(resource.custom_id);
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
        const { data: insertedPayment, error: paymentErr } = await supabaseAdmin
          .from("payments")
          .insert({
            user_id: ref.user_id,
            app_id: ref.app_id,
            subscription_id: (sub as { id: string }).id,
            paypal_payment_id: resource.id,
            amount,
            currency,
            status: "success",
            payment_method: "paypal",
          })
          .select("id")
          .single();
        if (paymentErr) {
          console.error("PayPal webhook: payments insert failed", paymentErr);
          return Response.json({ received: true, duplicate: true });
        }

        // Priority 17: Public Coupons -- see the matching, more fully
        // commented branch in the Stripe webhook for the full rationale.
        if (couponRef && insertedPayment) {
          const { data: couponRow } = await supabaseAdmin
            .from("public_coupons")
            .select("max_total_uses, max_uses_per_user")
            .eq("id", couponRef.coupon_id)
            .maybeSingle();
          const limits = couponRow as { max_total_uses: number | null; max_uses_per_user: number } | null;
          const { data: redemption } = await supabaseAdmin.rpc("redeem_coupon_atomic", {
            p_coupon_id: couponRef.coupon_id,
            p_user_id: couponRef.user_id,
            p_max_total_uses: limits?.max_total_uses ?? null,
            p_max_uses_per_user: limits?.max_uses_per_user ?? 1,
            p_final_price: amount,
            p_currency: currency,
            p_payment_id: insertedPayment.id,
          });
          const result = (redemption as { ok: boolean; error_code: string | null }[] | null)?.[0];
          if (!result?.ok) {
            console.warn("PayPal webhook: coupon redemption not recorded", {
              coupon_id: couponRef.coupon_id,
              reason: result?.error_code,
            });
            await writeAuditLog({
              userId: couponRef.user_id,
              action: "public_coupon.redemption_skipped_after_payment",
              entityType: "payment",
              entityId: insertedPayment.id,
              newData: { coupon_id: couponRef.coupon_id, reason: result?.error_code },
            });
          }
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

        const { grantRewardAction, recordPremiumReferralIfApplicable } = await import(
          "@/lib/rewards.server"
        );
        // Priority 16: proportional financial points (EUR paid x 10).
        // Server-verified amount only. Non-EUR reported, not guessed.
        if (currency.toUpperCase() === "EUR" && insertedPayment) {
          await grantRewardAction({
            userId: ref.user_id,
            action: isRenewal ? "premium_renewal" : "premium_purchase",
            resourceType: "payment",
            resourceId: insertedPayment.id,
            sourceAppId: ref.app_id,
            amountEur: amount,
            dedupeKey: `payment:${insertedPayment.id}`,
          });
        } else if (insertedPayment) {
          console.warn("PayPal webhook: non-EUR payment, proportional points not calculated", {
            payment_id: insertedPayment.id,
            currency,
          });
          await writeAuditLog({
            userId: ref.user_id,
            action: "payment.paypal.non_eur_points_skipped",
            entityType: "payment",
            entityId: insertedPayment.id,
            newData: { currency, amount },
          });
        }
        await recordPremiumReferralIfApplicable({
          userId: ref.user_id,
          subscriptionId: (sub as { id: string }).id,
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
