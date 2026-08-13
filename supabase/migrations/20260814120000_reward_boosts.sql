-- Reward Boosts -- new CORE feature, Priority 17. A temporary multiplier
-- on an existing reward_action_rules action, read by the EXISTING
-- grantRewardAction() -- not a second reward calculation engine. Kept
-- deliberately simple per spec: action + multiplier + validity window.

CREATE TABLE IF NOT EXISTS public.reward_boosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text REFERENCES public.reward_action_rules(action) ON DELETE CASCADE NOT NULL,
  multiplier numeric NOT NULL CHECK (multiplier > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (ends_at > starts_at),
  enabled boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- grantRewardAction()'s hot-path lookup: is there a currently-active boost
-- for this action, right now.
CREATE INDEX IF NOT EXISTS idx_reward_boosts_active_lookup
  ON public.reward_boosts(action, starts_at, ends_at) WHERE enabled = true AND archived = false;

GRANT SELECT ON public.reward_boosts TO authenticated;
GRANT ALL ON public.reward_boosts TO service_role;
ALTER TABLE public.reward_boosts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Reward boosts are publicly readable" ON public.reward_boosts;
CREATE POLICY "Reward boosts are publicly readable"
  ON public.reward_boosts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage reward boosts" ON public.reward_boosts;
CREATE POLICY "Admins manage reward boosts"
  ON public.reward_boosts FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
