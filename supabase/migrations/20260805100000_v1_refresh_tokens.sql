-- Priority 8.11: Formal /v1 API implementation.
--
-- Necessary infrastructure for the already-approved authentication design
-- (API_CONTRACT.md -> Authentication & application identity, decided
-- Priority 8.9): a single, unified CORE-issued JWT is short-lived (15
-- minutes) and stateless (verified via JWKS, never looked up in the
-- database) -- but the long-lived refresh token it's paired with is
-- explicitly specified as "opaque, single-use, rotating... stored hashed,
-- server-side, and can be individually revoked." That requires exactly one
-- new table; there is no way to implement single-use rotation or
-- individual revocation for an opaque token without server-side storage to
-- check it against. This is the minimal necessary implementation of a
-- mechanism already specified, not a new architectural decision.
--
-- Only ever written/read via supabaseAdmin (service_role) from
-- src/lib/v1/jwt.server.ts -- no authenticated or anonymous client has any
-- business reading raw token hashes, so RLS is enabled with zero policies
-- for those roles (fully locked down by default), matching the same
-- "deny unless service_role" posture audit_logs already uses for its own
-- writes.
CREATE TABLE public.v1_refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  app_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  -- SHA-256 hex digest of the opaque refresh token -- the plaintext token
  -- itself is never stored, only ever returned once to the caller at
  -- issuance/rotation time, exactly like the withdrawn App Token design's
  -- own "never stored, never returned again" rule (API_CONTRACT.md -> §7).
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- Set the moment this token is used to mint a new one (rotation) or is
  -- explicitly revoked (POST /v1/auth/logout) -- a non-null value means
  -- this token can never be used again, checked on every refresh attempt.
  revoked_at timestamptz,
  replaced_by uuid REFERENCES public.v1_refresh_tokens(id) ON DELETE SET NULL
);

CREATE INDEX v1_refresh_tokens_user_id_idx ON public.v1_refresh_tokens(user_id);
CREATE INDEX v1_refresh_tokens_token_hash_idx ON public.v1_refresh_tokens(token_hash);

ALTER TABLE public.v1_refresh_tokens ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated/anon -- service_role only, by design.
