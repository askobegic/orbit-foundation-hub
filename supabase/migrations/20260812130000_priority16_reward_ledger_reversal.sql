-- Priority 16 Phase B: automatic refund/reversal support for reward_ledger.
--
-- Phase A audit finding: a refunded Stripe (or unhandled PayPal) purchase
-- currently keeps every point it was granted -- no reversal path exists.
-- The approved ruleset requires refunds to claw back points automatically,
-- WITHOUT using the manual-admin-adjustment path (that path is reserved
-- for genuine human admin decisions, always carrying a mandatory `reason`
-- -- an automatic system reversal is a different, non-discretionary kind
-- of event and must stay distinguishable from it in the ledger).
--
-- Adds a new origin value, 'refund_reversal', written only by
-- src/lib/rewards.server.ts's reversePaymentPoints() (Stripe/PayPal
-- refund webhook handlers only -- never client- or admin-invoked), and
-- widens the existing non-negativity CHECK to permit negative
-- points/lifetime_points for that origin too, alongside the pre-existing
-- 'manual_admin' exemption. Append-only, consistent with the rest of this
-- table: a reversal is always a NEW negative row, never an edit or delete
-- of the original grant.

ALTER TABLE public.reward_ledger DROP CONSTRAINT IF EXISTS reward_ledger_origin_check;
ALTER TABLE public.reward_ledger ADD CONSTRAINT reward_ledger_origin_check
  CHECK (origin IN ('core', 'application', 'api', 'n8n', 'manual_admin', 'system', 'refund_reversal'));

ALTER TABLE public.reward_ledger DROP CONSTRAINT IF EXISTS reward_ledger_points_nonneg_check;
ALTER TABLE public.reward_ledger ADD CONSTRAINT reward_ledger_points_nonneg_check
  CHECK (origin IN ('manual_admin', 'refund_reversal') OR (points >= 0 AND lifetime_points >= 0));
