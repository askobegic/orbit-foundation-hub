
-- Reject non-http(s) URLs in premium_profiles link columns at the
-- database level (defense in depth alongside the new frontend check in
-- src/lib/url.ts). Without this, a javascript:/data:/vbscript:/file:
-- URI stored in website/*_url could be rendered as an <a href> on a
-- user's public profile page and execute in any visitor's browser.
-- See PROJECT_AUDIT.md -> CO-1 / SE-6.
--
-- Added NOT VALID: enforces the rule for all future INSERT/UPDATE
-- without validating (and potentially rejecting) rows that already
-- exist today. Existing data is left exactly as-is, per the fix's
-- requirement that existing data remain compatible; only new writes
-- are constrained. The frontend/render-side guard in u.$username.tsx
-- (isSafeProfileUrl) is what protects visitors from any already-stored
-- unsafe value in the meantime.

ALTER TABLE public.premium_profiles
  ADD CONSTRAINT premium_profiles_website_scheme_chk
    CHECK (website IS NULL OR website ~* '^https?://') NOT VALID,
  ADD CONSTRAINT premium_profiles_facebook_url_scheme_chk
    CHECK (facebook_url IS NULL OR facebook_url ~* '^https?://') NOT VALID,
  ADD CONSTRAINT premium_profiles_instagram_url_scheme_chk
    CHECK (instagram_url IS NULL OR instagram_url ~* '^https?://') NOT VALID,
  ADD CONSTRAINT premium_profiles_tiktok_url_scheme_chk
    CHECK (tiktok_url IS NULL OR tiktok_url ~* '^https?://') NOT VALID,
  ADD CONSTRAINT premium_profiles_youtube_url_scheme_chk
    CHECK (youtube_url IS NULL OR youtube_url ~* '^https?://') NOT VALID,
  ADD CONSTRAINT premium_profiles_linkedin_url_scheme_chk
    CHECK (linkedin_url IS NULL OR linkedin_url ~* '^https?://') NOT VALID,
  ADD CONSTRAINT premium_profiles_x_url_scheme_chk
    CHECK (x_url IS NULL OR x_url ~* '^https?://') NOT VALID;
