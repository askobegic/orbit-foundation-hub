
-- Per-application Google OAuth Client ID, for the Application Resolver /
-- multi-brand Google Sign-In architecture (Core v1.0 Authentication
-- Finalization). Each application registers its own Google Cloud OAuth
-- Client (its own consent-screen name/logo); all of them are added to
-- Supabase Auth's Google provider "Client IDs" list so signInWithIdToken
-- accepts any of them, while every one still resolves to the same
-- auth.users / profiles identity. See PROJECT_KNOWLEDGE.md -> Authentication.
--
-- Not secret -- Google OAuth Client IDs are meant to be public (shipped to
-- the browser), so this column stays in the already publicly-readable
-- `applications` table with no RLS change. The Client Secret is never
-- stored here; it stays only in Supabase's Google provider configuration.

ALTER TABLE public.applications ADD COLUMN google_client_id text;
