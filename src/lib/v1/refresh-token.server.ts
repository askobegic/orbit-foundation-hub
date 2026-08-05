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

// Single-use rotation: the presented token is immediately marked revoked
// (linked via replaced_by to its successor) the moment it's exchanged --
// reusing an already-rotated token is rejected the same as a revoked one.
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
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

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

  const { error: revokeErr } = await supabaseAdmin
    .from("v1_refresh_tokens")
    .update({ revoked_at: new Date().toISOString(), replaced_by: newRow.id })
    .eq("id", row.id);
  if (revokeErr) throw new Error(revokeErr.message);

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
