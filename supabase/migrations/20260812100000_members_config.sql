-- CORE Members System: admin-configurable display/pagination settings.
-- Same key/value config-table shape as reward_config/ad_config/
-- engagement_config/trial_policy -- not a new configuration mechanism.
--
-- premium_section_count/verified_section_count/new_section_count/
-- directory_page_size affect display and pagination only -- they never
-- change who is eligible to appear (that remains entirely governed by the
-- existing Premium Status Resolver and profiles.is_verified, untouched
-- here). new_member_days is the one exception by design: it is the
-- configurable window used to classify a member as "New" -- a
-- classification rule, not merely a display count -- but it still never
-- touches Premium/verification eligibility, only which members qualify as
-- "New."

CREATE TABLE IF NOT EXISTS public.members_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.members_config TO anon, authenticated;
GRANT ALL ON public.members_config TO service_role;
ALTER TABLE public.members_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members config is publicly readable" ON public.members_config;
CREATE POLICY "Members config is publicly readable"
  ON public.members_config FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.members_config (key, value, description) VALUES
  ('premium_section_count', '6'::jsonb, 'How many cards to show in the Premium Members section on the Members landing page.'),
  ('verified_section_count', '6'::jsonb, 'How many cards to show in the Verified Members section on the Members landing page.'),
  ('new_section_count', '6'::jsonb, 'How many cards to show in the New Members section on the Members landing page.'),
  ('directory_page_size', '24'::jsonb, 'How many members per page in the full Members directory/search results.'),
  ('new_member_days', '30'::jsonb, 'How many days after registration a member is classified as "New".')
ON CONFLICT (key) DO NOTHING;
