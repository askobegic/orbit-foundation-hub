-- Registers Core itself as an application in the Applications Registry,
-- so the shared /login flow has something to resolve when Core is visited
-- on its own domain (core.logid.pro) directly -- e.g. the administrator
-- signing in to reach /admin. This does not change what "application"
-- means anywhere else: Core is not privileged over any other row, it is
-- simply now one of them, exactly like BosniaFans or any future app. See
-- PROJECT_KNOWLEDGE.md -> Authentication -> "Core as a centralized
-- Identity Provider".
--
-- primary_color/secondary_color are intentionally omitted -- the column
-- defaults ('#1D6BF3'/'#6366F1', set when this table was created) are
-- Core's own existing UI accent colors, already used throughout the admin
-- panel and login page chrome, making them the neutral, non-arbitrary
-- choice for Core's own branding rather than a newly invented one.
--
-- google_client_id is deliberately left NULL here: it is not secret, but
-- its real value is only known in Google Cloud Console, not in this
-- repository. Login for this application will show its "not available"
-- state until an administrator sets it via /admin/applications -- the
-- existing, ordinary configuration path every other application already
-- uses, not a workaround.
INSERT INTO public.applications (name, slug, domain, visibility)
VALUES ('Core Platform', 'core', 'core.logid.pro', 'active')
ON CONFLICT (slug) DO NOTHING;
