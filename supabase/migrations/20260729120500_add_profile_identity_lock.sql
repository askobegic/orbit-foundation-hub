
-- Identity Lock: first_name, last_name, and avatar_url are imported once
-- from the user's identity provider (or, for avatar_url, uploaded once by
-- the user if the provider supplied none) and become permanently locked
-- once onboarding completes. See PROJECT_KNOWLEDGE.md -> Profiles.
--
-- Deliberately NOT implemented as a REVOKE UPDATE on these columns (unlike
-- user_type/is_verified/is_active -- see protect_profile_privileged_columns
-- migration): those columns are NEVER user-writable, whereas first_name/
-- last_name/avatar_url legitimately ARE user-writable exactly once, during
-- onboarding, before the lock exists. A blanket column-grant revoke cannot
-- express "writable until locked, then not" -- it would also break the
-- onboarding write itself. A trigger can compare OLD vs NEW and gate on a
-- per-row lock state, which a static grant/RLS predicate cannot do without
-- also needing a trigger anyway (RLS has no way to auto-derive a value like
-- the lock timestamp). This keeps Core (service_role) able to manage these
-- fields at any time -- including a future administrator-controlled
-- identity-change workflow -- with no further migration ever required to
-- "unlock" anything: service_role is exempted directly in the trigger.

ALTER TABLE public.profiles ADD COLUMN identity_locked_at timestamptz;

-- identity_locked_at is intentionally never added to the `authenticated`
-- column-level UPDATE grant (see protect_profile_privileged_columns.sql) --
-- it is set only by this trigger, never directly by a client.

CREATE OR REPLACE FUNCTION public.enforce_identity_lock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Core (service_role) manages identity fields directly, lock or not --
  -- this is the seam a future administrator-controlled identity-change
  -- workflow uses; no schema change will be needed to support it.
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- The lock engages automatically the moment onboarding completes.
  IF NEW.profile_complete = true AND OLD.profile_complete = false AND OLD.identity_locked_at IS NULL THEN
    NEW.identity_locked_at := now();
    RETURN NEW;
  END IF;

  -- Once locked, reject any change to the locked identity fields from
  -- non-Core callers. Uses IS DISTINCT FROM so NULL <-> NULL is not
  -- treated as a change.
  IF OLD.identity_locked_at IS NOT NULL THEN
    IF NEW.first_name IS DISTINCT FROM OLD.first_name
       OR NEW.last_name IS DISTINCT FROM OLD.last_name
       OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
      RAISE EXCEPTION 'Identity fields are locked and cannot be modified.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_identity_lock ON public.profiles;
CREATE TRIGGER profiles_enforce_identity_lock
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_identity_lock();
