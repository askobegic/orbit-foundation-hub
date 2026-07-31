-- Restore public.payments.stripe_payment_intent_id -- confirmed missing
-- live (PGRST204 "Could not find the 'stripe_payment_intent_id' column of
-- 'payments' in the schema cache" during Priority 4 payment-flow testing,
-- and directly via `select stripe_payment_intent_id from payments limit 1`
-- returning "column does not exist").
--
-- Same root cause as every other restoration this session: `supabase
-- migration list` shows 20260727100000_add_stripe_payment_intent_id.sql as
-- applied remotely, but it never actually ran against this database. Without
-- this column, every Stripe webhook fulfillment silently fails to record its
-- payments row (SE-9 logs the error but doesn't block activation) and the
-- BL-1 Stripe refund-matching query (`.eq("stripe_payment_intent_id", ...)`)
-- can never match anything.
--
-- IF NOT EXISTS so this is safe to run even if the column does turn out to
-- already exist by the time this applies.

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
