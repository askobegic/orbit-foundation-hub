-- CORE Premium Service (Priority 6): cross-application Premium status,
-- backing the new hasAnyActivePremium()/getPremiumApplications() methods.
--
-- Premium purchase remains scoped per (user, application) -- nothing here
-- changes that model or touches the subscriptions/premium_profiles schema.
-- Only the *contact-eligibility* rule changes: a Premium member may now
-- contact any other Premium member anywhere on the platform, not only one
-- sharing the same application. These two functions exist so that rule is
-- answered by one shared, reusable check (mirroring the exact "active"
-- predicate is_user_premium(uuid, uuid) already uses), never re-derived
-- ad hoc in a component.

CREATE OR REPLACE FUNCTION public.has_any_active_premium(_user_id uuid)
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
      AND s.status = 'active'
      AND s.expires_at > now()
  )
$$;

REVOKE ALL ON FUNCTION public.has_any_active_premium(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_any_active_premium(uuid) TO anon, authenticated;

-- Backs "Premium on: <apps>" -- only ever displays applications that are
-- themselves active (status = 'active'), matching the existing display
-- rule already used for this section (an application withdrawn/paused at
-- the platform level shouldn't appear even if a stale subscription row
-- still technically satisfies the date range).
CREATE OR REPLACE FUNCTION public.get_premium_application_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id
  FROM public.subscriptions s
  JOIN public.applications a ON a.id = s.app_id
  WHERE s.user_id = _user_id
    AND s.status = 'active'
    AND s.expires_at > now()
    AND a.status = 'active'
  ORDER BY a.sort_order
$$;

REVOKE ALL ON FUNCTION public.get_premium_application_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_premium_application_ids(uuid) TO anon, authenticated;
