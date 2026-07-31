-- Global Premium Visibility & Contact System.
--
-- Premium is ecosystem-wide: is_user_premium(uuid, uuid) (the per-application
-- scoped check added for DB-4) has zero call sites anywhere in the
-- application code -- the only "is this user Premium" check consumed
-- anywhere is has_any_active_premium(uuid), which is already global.
-- Dropping the per-app function removes the one remaining seam that could
-- let an app-scoped Premium check creep back into a future surface.
DROP FUNCTION IF EXISTS public.is_user_premium(uuid, uuid);

-- Replaces "Premium on: <apps>" as the Profile Card badge row's data
-- source. Under global Premium, "which application was this purchased
-- under" no longer answers a meaningful permission question -- the only
-- per-application concept left that's still meaningful is presence
-- (user_app_settings.is_visible), so the badge row now shows "where does
-- this person have a public profile" instead of "where did they buy
-- Premium." get_premium_application_ids() is left in place, unused, rather
-- than dropped -- no call site references it after this change, but
-- removing it was not requested.
CREATE OR REPLACE FUNCTION public.get_visible_application_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id
  FROM public.user_app_settings uas
  JOIN public.applications a ON a.id = uas.app_id
  WHERE uas.user_id = _user_id
    AND uas.is_visible = true
    AND a.status = 'active'
  ORDER BY a.sort_order
$$;

REVOKE ALL ON FUNCTION public.get_visible_application_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visible_application_ids(uuid) TO anon, authenticated;
