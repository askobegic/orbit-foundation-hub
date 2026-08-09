// Priority 14: production CORS policy for /v1.
//
// Allowed origins are derived entirely from applications.domain -- the same
// column already used for domain-based application resolution
// (application-resolver.functions.ts) -- never a hardcoded list, so a new
// application becomes CORS-allowed the moment its domain is configured, with
// no code change or redeploy. No app-specific branching: every domain in
// that column is treated identically. See PROJECT_AUDIT.md -> PR11-11.
//
// CORS is a browser-enforced, read-side control, not a server-side access
// gate: an unrecognized Origin never blocks the server from processing or
// returning a response (a server-to-server caller sends no Origin header at
// all and is unaffected) -- it only controls whether Access-Control-Allow-
// Origin is present, which is what lets a browser's own same-origin policy
// keep blocking a disallowed page's JS from reading the response. This
// mirrors PR11-11's own framing: the *absence* of the header is what fails
// closed, not an explicit reject.

const CACHE_TTL_MS = 60_000;
let cachedOrigins: Set<string> | null = null;
let cachedAt = 0;

async function getAllowedOrigins(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedOrigins && now - cachedAt < CACHE_TTL_MS) return cachedOrigins;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("applications")
    .select("domain")
    .not("domain", "is", null);

  const origins = new Set<string>();
  for (const row of data ?? []) {
    if (row.domain) origins.add(`https://${row.domain}`);
  }
  cachedOrigins = origins;
  cachedAt = now;
  return origins;
}

export const CORS_ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
export const CORS_ALLOWED_HEADERS = "Content-Type, Authorization, Accept-Language";
const CORS_MAX_AGE_SECONDS = "86400";

// Returns the exact Origin to echo back (never "*") when it matches a
// registered application domain, otherwise null. Callers must omit
// Access-Control-Allow-Origin entirely on null rather than substitute any
// default value.
export async function resolveAllowedOrigin(originHeader: string | null): Promise<string | null> {
  if (!originHeader) return null;
  let hostname: string;
  try {
    hostname = new URL(originHeader).hostname.toLowerCase();
  } catch {
    return null;
  }
  const allowed = await getAllowedOrigins();
  return allowed.has(`https://${hostname}`) ? originHeader : null;
}

// Applied to every /v1/* response (any method). Vary: Origin is required
// whenever Allow-Origin's value depends on the request's Origin (true here,
// always) so a shared/CDN cache never serves one origin's CORS-approved
// response to a different origin.
export function applyCorsHeaders(response: Response, allowedOrigin: string | null): Response {
  const headers = new Headers(response.headers);
  headers.append("Vary", "Origin");
  if (allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Preflight short-circuit -- /v1 has no route that itself handles OPTIONS,
// so this must run before the request ever reaches the file-based router.
export function corsPreflightResponse(allowedOrigin: string | null): Response {
  const headers = new Headers();
  headers.append("Vary", "Origin");
  if (allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
    headers.set("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
    headers.set("Access-Control-Max-Age", CORS_MAX_AGE_SECONDS);
  }
  return new Response(null, { status: 204, headers });
}
