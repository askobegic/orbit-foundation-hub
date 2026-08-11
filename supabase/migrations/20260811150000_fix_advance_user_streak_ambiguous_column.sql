-- Corrective migration for Priority 15 Phase B's advance_user_streak()
-- (introduced in 20260811120000_missions_challenges_streaks.sql, already
-- applied to production). Live verification found every invocation
-- failing with:
--
--   ERROR 42702: column reference "longest_streak" is ambiguous
--
-- Root cause: RETURNS TABLE(current_streak integer, longest_streak
-- integer, changed boolean) implicitly declares current_streak/
-- longest_streak as PL/pgSQL OUT variables, which collide with
-- user_streaks' own column names of the same name inside the function
-- body's UPDATE statement. Fixed by aliasing the UPDATE target
-- (public.user_streaks AS us) and qualifying every reference to the
-- table's longest_streak column with that alias, so PostgreSQL can no
-- longer confuse it with the OUT variable. Logic, signature, and return
-- shape are otherwise byte-for-byte identical to the original --
-- 20260811120000 is left untouched (never edit an already-applied
-- migration); this is a new, additive CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.advance_user_streak(
  p_user_id uuid,
  p_streak_definition_id uuid,
  p_activity_date date
) RETURNS TABLE(current_streak integer, longest_streak integer, changed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_date date;
  v_prev_current integer;
  v_new_current integer;
  v_new_longest integer;
  v_changed boolean;
BEGIN
  INSERT INTO public.user_streaks (user_id, streak_definition_id, current_streak, longest_streak, last_qualifying_date, updated_at)
  VALUES (p_user_id, p_streak_definition_id, 0, 0, NULL, now())
  ON CONFLICT (user_id, streak_definition_id) DO NOTHING;

  SELECT us.last_qualifying_date, us.current_streak
    INTO v_prev_date, v_prev_current
    FROM public.user_streaks us
    WHERE us.user_id = p_user_id AND us.streak_definition_id = p_streak_definition_id
    FOR UPDATE;

  IF v_prev_date IS NOT NULL AND v_prev_date = p_activity_date THEN
    v_new_current := v_prev_current;
    v_changed := false;
  ELSIF v_prev_date IS NOT NULL AND v_prev_date = p_activity_date - 1 THEN
    v_new_current := v_prev_current + 1;
    v_changed := true;
  ELSE
    v_new_current := 1;
    v_changed := true;
  END IF;

  -- Table aliased and every reference to its longest_streak column
  -- qualified via that alias -- the fix. GREATEST(us.longest_streak, ...)
  -- and RETURNING us.longest_streak can no longer be confused with the
  -- RETURNS TABLE OUT variable of the same name.
  UPDATE public.user_streaks AS us
    SET current_streak = v_new_current,
        longest_streak = GREATEST(us.longest_streak, v_new_current),
        last_qualifying_date = p_activity_date,
        updated_at = now()
    WHERE us.user_id = p_user_id AND us.streak_definition_id = p_streak_definition_id
    RETURNING us.longest_streak INTO v_new_longest;

  RETURN QUERY SELECT v_new_current, v_new_longest, v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_user_streak(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_user_streak(uuid, uuid, date) TO service_role;
