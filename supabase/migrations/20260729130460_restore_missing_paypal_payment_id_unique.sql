-- Restore payments_paypal_payment_id_key -- confirmed missing live during
-- Priority 4 payment-flow testing: two inserts with the same
-- paypal_payment_id succeeded with no error, when this UNIQUE constraint
-- should have rejected the second one (PROJECT_AUDIT.md -> SE-15).
--
-- Same root cause as every other restoration this session: `supabase
-- migration list` shows 20260727090000_unique_paypal_payment_id.sql as
-- applied remotely, but it never actually ran against this database.
-- Without it, paypal.ts's idempotency guard is a pure application-level
-- check-then-insert with no atomic backstop -- two near-simultaneous
-- redeliveries of the same capture could both pass the existence check
-- before either has inserted, producing duplicate payments rows.
--
-- Guarded so this is safe to run even if the constraint does turn out to
-- already exist by the time this applies.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_paypal_payment_id_key'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_paypal_payment_id_key UNIQUE (paypal_payment_id);
  END IF;
END $$;
