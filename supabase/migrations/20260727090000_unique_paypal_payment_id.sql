
-- Give payments.paypal_payment_id the same database-level uniqueness
-- payments.stripe_payment_id already has, so the idempotency guard added
-- in the paypal.ts webhook (an application-level check-then-insert) gets
-- an atomic backstop against two near-simultaneous redeliveries of the
-- same capture both passing that check before either has inserted.
-- See PROJECT_AUDIT.md -> SE-15.
--
-- NULLs are unaffected: Postgres UNIQUE constraints permit any number of
-- NULL values (every Stripe payment row has paypal_payment_id = NULL),
-- so this only constrains actual PayPal capture IDs against each other.
--
-- Note: unlike a CHECK constraint, Postgres does not support NOT VALID
-- for UNIQUE constraints -- this statement scans the existing table and
-- will fail outright if any duplicate non-null paypal_payment_id already
-- exists. That could not be verified against the live database from this
-- environment; if this migration fails to apply, identify and de-duplicate
-- the offending rows first.

ALTER TABLE public.payments
  ADD CONSTRAINT payments_paypal_payment_id_key UNIQUE (paypal_payment_id);
