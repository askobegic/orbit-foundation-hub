-- Security hotfix (follow-up): same anon/authenticated EXECUTE exposure as
-- 20260814150000, found on two more SECURITY DEFINER functions during that
-- hotfix's mandated broader audit. event_analytics_by_event() and
-- event_analytics_top_earners() are intended service_role-only -- called
-- exclusively from adminGetEventAnalytics() (events.functions.ts) after
-- assertAdmin() -- but both currently grant EXECUTE to anon and
-- authenticated, letting either bypass the admin check entirely via a
-- direct PostgREST RPC call and read cross-user reward analytics.
--
-- Privilege-only fix, same shape as 20260814150000. The prior hotfix's
-- ALTER DEFAULT PRIVILEGES correction (role postgres, schema public,
-- function objects) already covers these two functions going forward --
-- both are owned by postgres -- so it is not repeated here.

REVOKE EXECUTE ON FUNCTION public.event_analytics_by_event(uuid, timestamp with time zone)
  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.event_analytics_top_earners(uuid, timestamp with time zone, integer)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.event_analytics_by_event(uuid, timestamp with time zone)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.event_analytics_top_earners(uuid, timestamp with time zone, integer)
  TO service_role;
