-- Priority 11: Complete Security Audit & Hardening.
--
-- Fixes four Critical/High findings discovered via direct comparison of
-- live database state (pg_policies / role_table_grants / column_privileges)
-- against what this project's own migrations already declared. All four
-- share the same root cause already documented elsewhere in this repo (see
-- e.g. 20260729130300's header, and PROJECT_AUDIT.md -> DB-6/SE-16/SE-17):
-- a migration tracked as "applied" by `supabase migration list` that never
-- actually executed against the live database. Every statement below is
-- idempotent (safe to re-run) and additive/restrictive only -- nothing
-- here removes functionality any legitimate code path relies on.

-- ============================================================
-- 1. CRITICAL -- profiles_public / premium_profiles_public views grant
--    full CRUD to anon/authenticated instead of SELECT-only.
--
--    Both are plain (non security_invoker) views owned by the migration
--    runner, so DML through them runs with the view owner's privileges,
--    completely bypassing profiles/premium_profiles RLS. Live grants
--    included INSERT/UPDATE/DELETE/TRUNCATE for anon and authenticated on
--    both views -- confirmed live via information_schema.role_table_grants,
--    not assumed. 20260729130300 only ever GRANTed SELECT; it never had
--    occasion to REVOKE anything broader, because a newly-created object in
--    this Supabase project's default-privilege configuration already
--    starts with broad grants to anon/authenticated/service_role (the
--    project's documented "RLS is the enforcement boundary" baseline) --
--    for a *view*, RLS doesn't apply the way it does for a table, so those
--    baseline write grants were never actually closed off for these two
--    specific views. This revoke is the fix.
-- ============================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profiles_public FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.premium_profiles_public FROM anon, authenticated;

-- Defense-in-depth: force the views to run with the querying role's own
-- privileges/RLS rather than the owner's, so even a future stray broad
-- grant on the base tables can't be reached through these views.
ALTER VIEW public.profiles_public SET (security_invoker = on);
ALTER VIEW public.premium_profiles_public SET (security_invoker = on);

-- ============================================================
-- 2. CRITICAL -- profiles.user_type/is_verified/is_active self-escalation
--    (PROJECT_AUDIT.md -> AU-1 / DB-1) is live again.
--
--    20260726120000 already fixed this once; live inspection shows
--    `authenticated` currently holds unrestricted column-level UPDATE/
--    INSERT on user_type/is_verified/is_active/id, and the "Users can
--    update own profile" policy's WITH CHECK is null -- i.e. that
--    migration never actually ran. Re-asserting its exact fix here,
--    verbatim, since re-running the original file is not permitted
--    (migrations are never edited/re-applied once written -- see
--    CLAUDE.md -> Migration Rules) and idempotent re-assertion in a new
--    migration is the correct way to recover from this class of drift.
-- ============================================================

REVOKE UPDATE ON public.profiles FROM authenticated;

GRANT UPDATE (
  first_name,
  last_name,
  avatar_url,
  city,
  country,
  username,
  bio,
  language,
  email,
  profile_complete
) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- 3. CRITICAL -- undocumented live INSERT policy on subscriptions lets
--    any authenticated user self-grant unlimited free Premium for any
--    application.
--
--    No migration in this repository creates a policy named "Users insert
--    own subscriptions" (grepped all migration files) -- this is
--    unexplained live drift, not a missing-migration gap. Every legitimate
--    entitlement write already goes through service_role (Stripe/PayPal
--    webhooks, admin grant/revoke, promotional trials), which bypasses RLS
--    entirely and is unaffected by dropping this policy.
-- ============================================================

DROP POLICY IF EXISTS "Users insert own subscriptions" ON public.subscriptions;

-- ============================================================
-- 4. HIGH -- conversations INSERT policy has no eligibility check.
--
--    getOrCreateConversation (conversation.functions.ts) verifies the
--    messaging capability, both-sides-Premium, and recipient
--    is_contactable in application code, but its own INSERT ran through
--    the caller's own session -- meaning a direct REST/Supabase-client
--    call could create a conversation with anyone, bypassing every one of
--    those checks. The /v1 equivalent (routes/v1/conversations/index.ts)
--    already writes via service_role and is unaffected by this change.
--    conversation.functions.ts is updated in the same pass (application
--    code, not this migration) to write through service_role too, exactly
--    matching the ad_campaigns pattern already used elsewhere in this
--    codebase for the same reason.
-- ============================================================

DROP POLICY IF EXISTS "Participants can create their conversations" ON public.conversations;

-- ============================================================
-- 5. CRITICAL -- avatar/banner uploads have no server-side MIME/size
--    enforcement independent of application code.
--
--    AvatarUpload.tsx uploads directly via the browser Supabase client;
--    the only enforcement for that path was the storage RLS INSERT policy,
--    which checks only the folder prefix, never content-type or size.
--    Setting these at the bucket level enforces them for every upload
--    path (client-direct and the /v1/media/* server routes alike),
--    regardless of what any calling code does or doesn't check.
--    image/svg+xml is deliberately excluded -- see the branding.ts/
--    media-storage.ts code changes in this same pass for why.
-- ============================================================

UPDATE storage.buckets
SET file_size_limit = 5242880, -- 5 MB, matching every upload route's own limit
    allowed_mime_types = ARRAY[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/x-icon',
      'image/vnd.microsoft.icon'
    ]
WHERE id = 'core';
