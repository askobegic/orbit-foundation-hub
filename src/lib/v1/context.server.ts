// Priority 8.11: "who is calling, and through which application" --
// resolved exactly per API_CONTRACT.md §3.3's one global rule, applied by
// every /v1 handler through these functions only (never re-derived
// per-endpoint).
import { ApiError } from "@/lib/v1/http.server";
import { verifyAccessToken, type VerifiedAccessToken } from "@/lib/v1/jwt.server";

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

// Every authenticated endpoint's entry point -- §3.3: the caller's own JWT
// is the only source of "current application" for any action that affects
// a real permission or eligibility decision.
export async function requireUserContext(request: Request): Promise<VerifiedAccessToken> {
  const token = bearerToken(request);
  if (!token) throw new ApiError("UNAUTHORIZED", "Missing or invalid Authorization header");
  const verified = await verifyAccessToken(token);
  if (!verified) throw new ApiError("UNAUTHORIZED", "Invalid or expired access token");
  return verified;
}

// For endpoints where a signed-in caller is optional (e.g. viewing a public
// profile) -- returns null rather than throwing when no/invalid token is
// present, so the caller can fall through to anonymous behavior.
export async function optionalUserContext(request: Request): Promise<VerifiedAccessToken | null> {
  const token = bearerToken(request);
  if (!token) return null;
  return verifyAccessToken(token);
}

// §3.2's second bullet: genuinely anonymous, public-browsing endpoints
// resolve "current application" from the caller's JWT `azp` when signed in,
// otherwise a required `?appId=` query parameter -- never a filter of its
// own, and never trusted for anything privileged (§3.3).
export async function resolveAppId(
  request: Request,
  url: URL,
  opts: { required: boolean },
): Promise<string | null> {
  const ctx = await optionalUserContext(request);
  if (ctx) return ctx.appId;
  const q = url.searchParams.get("appId");
  if (q) return q;
  if (opts.required) {
    throw new ApiError("VALIDATION_ERROR", "appId is required", [
      { field: "appId", issue: "required" },
    ]);
  }
  return null;
}

// §19: every /v1/admin/* endpoint -- reuses the existing assertAdmin()
// exactly (never a second admin check), re-verified server-side on every
// call, `azp` ignored entirely (admin is a Core-wide surface).
export async function requireAdminContext(request: Request): Promise<{ userId: string }> {
  const ctx = await requireUserContext(request);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { assertAdmin } = await import("@/lib/admin.server");
  try {
    await assertAdmin(supabaseAdmin, ctx.userId);
  } catch {
    throw new ApiError("FORBIDDEN", "Admin access required");
  }
  return { userId: ctx.userId };
}
