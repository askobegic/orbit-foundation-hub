
-- Capture the Stripe PaymentIntent ID at fulfillment time so a later
-- charge.refunded event (which references payment_intent, not the
-- Checkout Session ID already stored in stripe_payment_id) can be
-- matched back to the correct payments/subscriptions row.
-- See PROJECT_AUDIT.md -> BL-1 (Stripe refund phase).
--
-- Nullable, no backfill: existing rows predate this column and cannot be
-- resolved to a PaymentIntent without an extra Stripe API lookup, which
-- is out of scope here. Only payments fulfilled after this migration can
-- be automatically matched to a future refund event.

ALTER TABLE public.payments ADD COLUMN stripe_payment_intent_id text;
