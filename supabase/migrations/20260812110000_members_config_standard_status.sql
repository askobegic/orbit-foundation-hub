-- CORE Members System: final member-status rule -- there are only two
-- member types, Standard and Premium (every registered user is Standard
-- unless they hold active Premium); Verified is a status that can layer
-- onto either, never a third category/section. "New Member" is removed
-- entirely as a landing-page concept.
--
-- Corrective migration for the already-applied
-- 20260812100000_members_config.sql (never edit an applied migration):
-- renames verified_section_count -> standard_section_count (same shape,
-- new meaning: how many cards the Standard Members section shows, since
-- Verified no longer has its own section) and removes new_section_count/
-- new_member_days outright, since the New Members section and its
-- classification window no longer exist. premium_section_count and
-- directory_page_size are untouched.

UPDATE public.members_config
  SET key = 'standard_section_count',
      description = 'How many cards to show in the Standard Members section on the Members landing page.'
  WHERE key = 'verified_section_count';

-- Defensive: ensure the row exists even if the rename above matched
-- nothing (e.g. a fresh install where the old key was never seeded).
INSERT INTO public.members_config (key, value, description) VALUES
  ('standard_section_count', '6'::jsonb, 'How many cards to show in the Standard Members section on the Members landing page.')
ON CONFLICT (key) DO NOTHING;

DELETE FROM public.members_config WHERE key IN ('new_section_count', 'new_member_days');
