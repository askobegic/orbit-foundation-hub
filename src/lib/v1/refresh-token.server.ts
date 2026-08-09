// Priority 8.11: opaque, single-use, rotating refresh tokens
// (API_CONTRACT.md §3.1), backed by `v1_refresh_tokens` (see that
// migration's own header comment for why this table is the minimal
// necessary implementation of an already-specified mechanism, not a new
// design). Only ever called with `supabaseAdmin` -- this table has no
// authenticated/anon RLS policies at all.
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// 30 days. Not specified as an exact number in API_CONTRACT.md (flagged
// there as an implementation default, not an open architecture question --
// see API_CONTRACT.md §21).
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function issueRefreshToken(
  supabaseAdmin: SupabaseClient,
  userId: string,
  appId: string,
): Promise<string> {
  const token = newOpaqueToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();
  const { error } = await supabaseAdmin.from("v1_refresh_tokens").insert({
    user_id: userId,
    app_id: appId,
    token_hash: hashToken(token),
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
  return token;
}

export type RotatedRefreshToken = { userId: string; appId: string; refreshToken: string };

// Walks replaced_by from an already-rotated token to the live end of its
// chain and revokes it too. Presenting a token that's already been rotated
// away is the standard signal that it was stolen and is being replayed
// alongside the legitimate rotated chain (OAuth Security BCP "refresh
// token reuse detection") -- without this, a thief who captured an old
// token gets rejected, but the legitimate holder's still-active descendant
// token is left untouched and neither side is forced to re-authenticate.
async function revokeDescendantChain(
  supabaseAdmin: SupabaseClient,
  startReplacedBy: string | null,
): Promise<void> {
  let currentId = startReplacedBy;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const { data: child } = await supabaseAdmin
      .from("v1_refresh_tokens")
      .select("id, revoked_at, replaced_by")
      .eq("id", currentId)
      .maybeSingle();
    if (!child) return;
    if (!child.revoked_at) {
      await supabaseAdmin
        .from("v1_refresh_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", child.id)
        .is("revoked_at", null);
      return; // reached and revoked the live end of the chain
    }
    currentId = child.replaced_by;
  }
}

// Single-use rotation: the presented token is atomically claimed (a
// conditional UPDATE ... WHERE revoked_at IS NULL, not a plain UPDATE) the
// moment it's exchanged, so two concurrent callers presenting the same
// still-valid token can never both succeed -- only whichever request wins
// the row lock revokes the parent and its newly-minted child stays valid;
// the loser's own freshly-inserted child is revoked immediately so it's
// never left behind as an unlinked, valid token. Reusing an
// already-rotated token revokes its whole live descendant chain (see
// revokeDescendantChain) rather than just being rejected.
export async function rotateRefreshToken(
  supabaseAdmin: SupabaseClient,
  presentedToken: string,
): Promise<RotatedRefreshToken | null> {
  const hash = hashToken(presentedToken);
  const { data: row } = await supabaseAdmin
    .from("v1_refresh_tokens")
    .select("*")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  if (row.revoked_at) {
    await revokeDescendantChain(supabaseAdmin, row.replaced_by);
    return null;
  }

  const newToken = newOpaqueToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();
  const { data: newRow, error: insertErr } = await supabaseAdmin
    .from("v1_refresh_tokens")
    .insert({
      user_id: row.user_id,
      app_id: row.app_id,
      token_hash: hashToken(newToken),
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (insertErr) throw new Error(insertErr.message);

  const { data: claimed, error: revokeErr } = await supabaseAdmin
    .from("v1_refresh_tokens")
    .update({ revoked_at: new Date().toISOString(), replaced_by: newRow.id })
    .eq("id", row.id)
    .is("revoked_at", null)
    .select("id");
  if (revokeErr) throw new Error(revokeErr.message);

  if (!claimed || claimed.length === 0) {
    // Lost the race: another concurrent request already rotated this
    // token first. Revoke the child we just minted rather than leaving it
    // valid and unlinked.
    await supabaseAdmin
      .from("v1_refresh_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", newRow.id);
    return null;
  }

  return { userId: row.user_id, appId: row.app_id, refreshToken: newToken };
}

// POST /v1/auth/logout, `everywhere: false` -- revokes every refresh token
// for this (user, app) pair (the closest available meaning of "current
// session" without the access token itself carrying a refresh-token
// reference, which it deliberately doesn't -- access tokens stay stateless
// per §3.1).
export async function revokeRefreshTokensForApp(
  supabaseAdmin: SupabaseClient,
  userId: string,
  appId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("v1_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("app_id", appId)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
}

// `everywhere: true` -- revokes every refresh token for this user, across
// every application they've ever signed into.
export async function revokeAllRefreshTokensForUser(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("v1_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) throw new Error(error.message);
}
