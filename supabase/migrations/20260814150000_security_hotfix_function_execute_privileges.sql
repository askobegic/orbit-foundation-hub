-- Security hotfix: remove unauthorized anon/authenticated EXECUTE on four
-- internal, service-role-only SECURITY DEFINER functions, and correct the
-- schema-level default so future functions in public do not inherit this.
--
-- Root cause: this project has a pre-existing default-privilege grant on
-- schema public (object type "function", owned by role postgres) that
-- automatically grants EXECUTE to anon and authenticated on every new
-- function created in public, regardless of that function's own intent.
-- `REVOKE ALL ... FROM PUBLIC` does not undo this, because a default-ACL
-- grant to a named role (anon/authenticated) is a distinct ACL entry from
-- the implicit PUBLIC grant -- revoking from PUBLIC only removes the
-- "everyone" grant, not these explicit per-role grants made at creation
-- time. As a result, four SECURITY DEFINER functions that are only ever
-- meant to be called with service_role privileges (redeem_reward_atomic,
-- advance_user_streak, and Priority 17's record_ad_impression and
-- redeem_coupon_atomic) were directly callable via PostgREST RPC by any
-- anon or authenticated caller, bypassing all of their internal
-- assumptions about who is calling them.
--
-- Verified via a full call-site audit that every legitimate caller of all
-- four functions already uses the service-role client (supabaseAdmin), so
-- revoking anon/authenticated EXECUTE does not change any application
-- behavior -- see rewards.server.ts, advertising.functions.ts,
-- engagement.server.ts, and both payment webhooks.

REVOKE EXECUTE ON FUNCTION public.record_ad_impression(uuid)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.redeem_coupon_atomic(uuid, uuid, integer, integer, numeric, text, uuid)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.redeem_reward_atomic(uuid, text, integer, integer, integer, text, jsonb)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.advance_user_streak(uuid, uuid, date)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_ad_impression(uuid)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.redeem_coupon_atomic(uuid, uuid, integer, integer, numeric, text, uuid)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.redeem_reward_atomic(uuid, text, integer, integer, integer, text, jsonb)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.advance_user_streak(uuid, uuid, date)
  TO service_role;

-- Correct the root cause so a future function created by role postgres in
-- schema public does not silently inherit anon/authenticated EXECUTE
-- again. This changes the default going forward only -- it does not
-- retroactively touch any function's existing grants (including the four
-- above, whose grants were just corrected explicitly).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
