-- The CORE application (slug = 'core') is an internal Identity Provider,
-- never a user-facing product. Setting its visibility to 'draft' reuses the
-- existing, already-documented visibility semantics ("hidden from all normal
-- users, visible only to administrators") to keep it out of the regular user
-- dashboard and the public /v1 applications listing, while leaving it fully
-- functional for authentication and fully visible in the admin panel, which
-- does not filter by visibility.
UPDATE public.applications
SET visibility = 'draft'
WHERE slug = 'core';
