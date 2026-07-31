-- Priority 3 (Premium System): close PROJECT_AUDIT.md -> DB-4.
--
-- is_user_premium(_user_id) currently returns true if the user has ANY
-- active subscription to ANY application -- it ignores subscriptions.app_id
-- even though that column exists and is already used correctly everywhere
-- else (adminGrantPremium/adminRevokePremium, /dashboard/subscriptions).
-- Premium is defined per-application (see PROJECT_KNOWLEDGE.md -> Premium
-- Model); a global premium check contradicts that and was only ever
-- consumed by the public profile page (src/routes/u.$username.tsx).
--
-- This is the only call site, so the one-argument function is replaced
-- outright (not overloaded) -- there is no global "is premium" concept to
-- preserve.

DROP FUNCTION IF EXISTS public.is_user_premium(uuid);

CREATE OR REPLACE FUNCTION public.is_user_premium(_user_id uuid, _app_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.app_id = _app_id
      AND s.status = 'active'
      AND s.expires_at > now()
  )
$$;

REVOKE ALL ON FUNCTION public.is_user_premium(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_user_premium(uuid, uuid) TO anon, authenticated;
