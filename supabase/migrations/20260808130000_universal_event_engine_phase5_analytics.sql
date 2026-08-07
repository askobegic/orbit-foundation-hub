-- Priority 12 Phase 5: Universal Event & Rewards Engine -- analytics.
--
-- Cross-user aggregation over reward_ledger (most-rewarded events, top
-- earners) can't be done through PostgREST's query builder (no GROUP BY),
-- and doing it by fetching every row client-side doesn't scale as the
-- ledger grows. These two functions exist purely to make that aggregation
-- possible -- unlike has_any_active_premium/get_premium_application_ids
-- (Priority 6), which are per-user and safe for anon/authenticated, these
-- expose cross-user data (who earned what) and are service_role only,
-- called exclusively from assertAdmin()-gated server functions.

CREATE OR REPLACE FUNCTION public.event_analytics_by_event(_app_id uuid, _since timestamptz)
RETURNS TABLE(event_key text, execution_count bigint, total_points bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT action, count(*)::bigint AS execution_count, coalesce(sum(points), 0)::bigint AS total_points
  FROM public.reward_ledger
  WHERE (_app_id IS NULL OR source_app_id = _app_id)
    AND created_at >= _since
    AND points > 0
  GROUP BY action
  ORDER BY total_points DESC
  LIMIT 50
$$;

REVOKE ALL ON FUNCTION public.event_analytics_by_event(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_analytics_by_event(uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.event_analytics_top_earners(_app_id uuid, _since timestamptz, _limit int DEFAULT 20)
RETURNS TABLE(user_id uuid, total_points bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id, coalesce(sum(points), 0)::bigint AS total_points
  FROM public.reward_ledger
  WHERE (_app_id IS NULL OR source_app_id = _app_id)
    AND created_at >= _since
    AND points > 0
  GROUP BY user_id
  ORDER BY total_points DESC
  LIMIT _limit
$$;

REVOKE ALL ON FUNCTION public.event_analytics_top_earners(uuid, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_analytics_top_earners(uuid, timestamptz, int) TO service_role;
