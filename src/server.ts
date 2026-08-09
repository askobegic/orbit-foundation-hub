import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  applyCorsHeaders,
  corsPreflightResponse,
  resolveAllowedOrigin,
} from "./lib/v1/cors.server";

// API_CONTRACT.md §5 -- GET /v1/.well-known/jwks.json. Handled directly
// here, before the file-based router even runs, because TanStack Start's
// file-based route generator skips dot-prefixed folders (`.well-known`
// never gets picked up as a route no matter how the file is named) --
// there is no way to place this exact, contract-mandated path under
// src/routes/. Every other /v1 endpoint is a normal file-based route; this
// is the one unavoidable exception, not a pattern to repeat.
async function handleJwks(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== "/v1/.well-known/jwks.json") return null;
  const { getJwks } = await import("./lib/v1/jwt.server");
  return Response.json(getJwks(), { headers: { "Cache-Control": "public, max-age=300" } });
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Priority 11 security audit: none of these were set anywhere in the app
// (confirmed -- no CSP/frame/nosniff/referrer header existed at any layer).
// Applied to every response from this one choke-point rather than per
// route. `frame-ancestors 'none'` (plus the legacy X-Frame-Options for
// older browsers) closes a real clickjacking gap on /login, which handles
// Google OAuth and was previously framable. Deliberately NOT a full
// Content-Security-Policy -- restricting script-src/connect-src/etc.
// without being able to interactively verify every legitimate external
// resource this app loads (Google Identity Services' script and iframe,
// Supabase's API/storage domain) risks silently breaking the Google
// Sign-In flow in production; that's a follow-up requiring its own
// dedicated testing pass, not something to guess at here.
function withSecurityHeaders(response: Response): Response {
  // Rebuilt via a fresh Headers instance rather than mutating
  // response.headers in place -- a Response constructed deep inside
  // TanStack Start/Nitro's server-entry can carry an immutable Headers
  // guard, which makes in-place .set() calls silently no-op instead of
  // throwing (confirmed empirically: headers were absent from real
  // responses until switched to this construction).
  const headers = new Headers(response.headers);
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Priority 14: production CORS policy, scoped to /v1 only -- the main
// app's own SSR/HTML routes are never called cross-origin, so CORS is
// meaningless there. Allowed origins come from applications.domain (see
// cors.server.ts); an unrecognized Origin never blocks the request itself,
// it only withholds Access-Control-Allow-Origin, which is what keeps a
// browser's own same-origin policy blocking that page's JS from reading
// the response. Preflight OPTIONS is intercepted here, before the
// file-based router, since no /v1 route defines its own OPTIONS handler.
function isV1Path(pathname: string): boolean {
  return pathname === "/v1" || pathname.startsWith("/v1/");
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    const url = new URL(request.url);
    const isV1 = isV1Path(url.pathname);

    // Security headers apply everywhere, unconditionally; CORS headers are
    // layered on top only for /v1, and only ever computed once per request.
    async function finalize(response: Response): Promise<Response> {
      const withSecurity = withSecurityHeaders(response);
      if (!isV1) return withSecurity;
      const allowedOrigin = await resolveAllowedOrigin(request.headers.get("origin"));
      return applyCorsHeaders(withSecurity, allowedOrigin);
    }

    if (isV1 && request.method === "OPTIONS") {
      const allowedOrigin = await resolveAllowedOrigin(request.headers.get("origin"));
      return corsPreflightResponse(allowedOrigin);
    }

    try {
      const jwks = await handleJwks(request);
      if (jwks) return finalize(jwks);
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return finalize(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return finalize(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
