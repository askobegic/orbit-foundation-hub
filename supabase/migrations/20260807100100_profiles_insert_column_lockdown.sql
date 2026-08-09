-- Priority 11 follow-up: the previous migration in this pass
-- (20260807100000) re-locked UPDATE on profiles.user_type/is_verified/
-- is_active, mirroring the original DB-1/AU-1 fix exactly -- but that
-- original fix only ever touched UPDATE, never INSERT. Live verification
-- immediately after applying it showed `authenticated` still holds
-- column-level INSERT on all three trust-sensitive columns, and each has a
-- safe default (is_verified=false, is_active=true, user_type='standard').
-- A user only gets one INSERT of their own profiles row (id is their own
-- auth.uid(), enforced by the existing INSERT policy's WITH CHECK), but
-- that one insert is enough to permanently set user_type='premium'/
-- is_verified=true before the UPDATE lock ever comes into play -- an
-- INSERT-time variant of the exact same self-escalation bug, not
-- previously closed by either the original fix or this pass's first
-- migration.
--
-- Fix: restrict INSERT the same way UPDATE is restricted -- authenticated
-- may insert every column their own profile-creation flow actually sets,
-- but not these three; the column defaults supply the correct, safe
-- initial value regardless.

REVOKE INSERT ON public.profiles FROM authenticated;

GRANT INSERT (
  id,
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
