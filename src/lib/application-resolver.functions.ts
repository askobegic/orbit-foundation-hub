// Core Application Resolver.
//
// Single source of truth for "which application is this request for" and
// its branding (name, logo, favicon, colors, Google Client ID). No
// application is ever privileged as a "default" -- every application is
// equally reachable. Resolution order:
//   1. Explicit application identification: `app` (the application's
//      `slug`), passed as `?app=<slug>` on the shared login flow
//      (`/login`) by whichever application is redirecting the user in --
//      the "who is asking" signal. Stateless, no cookie, always wins when
//      present, identically in every environment (a development-only
//      convenience -- remembering an explicitly-picked application across
//      a session via a cookie -- is layered on top of this, never a
//      precondition for it; see step 3). This is what lets CORE live on
//      its own domain (core.logid.pro) while still knowing which relying
//      application actually initiated the login. Works for any number of
//      future applications with zero code changes here -- it's a single
//      lookup by `slug`, nothing app-specific.
//      `clientId` is accepted as a deprecated fallback alias for `app`
//      (the parameter's original name, before it was renamed to avoid
//      colliding with the unrelated OAuth/OIDC term "client ID") -- new
//      code must use `app`; `clientId` exists only so a link built against
//      the old name keeps working.
//   2. Exact hostname match against `applications.domain` -- used only
//      when no explicit `app` was given. This is what makes visiting an
//      application's own domain directly (including Core's own,
//      core.logid.pro) resolve correctly with no query param at all.
//   3. Development-only convenience: the application last explicitly
//      picked (via `?app=<slug>` or the dev-only Application Selector) is
//      remembered in a cookie so it keeps resolving across a whole session
//      without repeating the query param on every page. Reading (and
//      writing) this cookie is structurally unreachable outside a
//      development build (`import.meta.env.DEV`, a build-time constant --
//      never a runtime toggle) so it can never influence a production
//      resolution, deliberately, by construction, not by convention.
//   4. If nothing resolves, return null -- the caller (see
//      ApplicationContext) renders the Application Selector instead of
//      guessing an application. In production this only happens when
//      there is genuinely no domain match and no `app` was given, which
//      never occurs for a real, configured production domain -- Core
//      stays invisible to end users.
// See PROJECT_KNOWLEDGE.md -> Authentication (Application Resolver).
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import type { ApplicationRow } from "@/types/database";

export interface ApplicationBranding {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  cover_image_url: string | null;
  primary_color: string;
  secondary_color: string;
  google_client_id: string | null;
  // Pre-Launch / Public Launch standard -- see LaunchGate.tsx. Always
  // 'public' for slug === 'core' (the CORE platform itself is never
  // gated); every other application defaults to 'pre_launch'.
  launch_status: ApplicationRow["launch_status"];
}

const APP_OVERRIDE_COOKIE = "app_override";

function toBranding(row: ApplicationRow): ApplicationBranding {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    domain: row.domain,
    logo_url: row.logo_url,
    favicon_url: row.favicon_url,
    cover_image_url: row.cover_image_url,
    primary_color: row.primary_color,
    secondary_color: row.secondary_color,
    google_client_id: row.google_client_id,
    launch_status: row.launch_status,
  };
}

function extractHostname(host: string | null): string | null {
  if (!host) return null;
  return host.split(":")[0].toLowerCase();
}

async function findByDomain(hostname: string): Promise<ApplicationRow | null> {
  const { data } = await supabase
    .from("applications")
    .select("*")
    .eq("domain", hostname)
    .maybeSingle();
  return (data as ApplicationRow | null) ?? null;
}

async function findBySlug(slug: string): Promise<ApplicationRow | null> {
  const { data } = await supabase.from("applications").select("*").eq("slug", slug).maybeSingle();
  return (data as ApplicationRow | null) ?? null;
}

const resolveApplicationSchema = z.object({
  app: z.string().min(1).optional(),
  // Deprecated alias for `app` -- see the file-level comment above.
  clientId: z.string().min(1).optional(),
});

export const resolveApplication = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => resolveApplicationSchema.parse(raw ?? {}))
  .handler(async ({ data }): Promise<ApplicationBranding | null> => {
    // 1. Explicit identification always wins, in every environment, and
    // never falls through to hostname/cookie on a lookup miss -- a wrong
    // or stale `app` must fail closed (resolve to null, the same "no
    // application" state as any other unmatched case), never silently
    // substitute a different application.
    const explicitSlug = data.app ?? data.clientId;
    if (explicitSlug) {
      const row = await findBySlug(explicitSlug);
      // Development convenience only: remember an explicitly-identified
      // application so it keeps resolving across a whole session without
      // repeating ?app= on every page (used by the dev-only Application
      // Selector). Never happens in production -- same build-time gate as
      // step 3 below.
      if (row && import.meta.env.DEV) {
        setCookie(APP_OVERRIDE_COOKIE, row.slug, {
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
          sameSite: "lax",
        });
      }
      return row ? toBranding(row) : null;
    }

    // 2. Hostname match -- unchanged, authoritative for any application
    // (including Core's own) still reached by visiting its own domain.
    const request = getRequest();
    const hostname = extractHostname(request?.headers.get("host") ?? null);
    let row = hostname ? await findByDomain(hostname) : null;

    // 3. Development-only convenience: fall back to a previously
    // explicitly-picked application's cookie. `import.meta.env.DEV` is a
    // build-time constant inlined by Vite -- a production build has this
    // branch compiled out as dead code, not merely "usually false", so
    // app_override can never influence a production resolution.
    if (!row && import.meta.env.DEV) {
      const cookieSlug = getCookie(APP_OVERRIDE_COOKIE);
      if (cookieSlug) row = await findBySlug(cookieSlug);
    }

    return row ? toBranding(row) : null;
  });
