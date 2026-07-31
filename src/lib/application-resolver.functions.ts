// Core Application Resolver.
//
// Single source of truth for "which application is this request for" and
// its branding (name, logo, favicon, colors, Google Client ID). No
// application is ever privileged as a "default" -- every application is
// equally reachable. Resolution order:
//   1. Exact hostname match against `applications.domain` (production;
//      always wins -- unchanged, authoritative).
//   2. An explicit override: `overrideSlug` passed in (set once by picking
//      an application in the dev-only Application Selector, or via
//      `?app=<slug>` on the very first request), persisted in a cookie so
//      the choice sticks across the whole session (login -> onboarding ->
//      dashboard), or the same cookie read back on a later request with no
//      override input.
//   3. If neither resolves anything, return null -- the caller (see
//      ApplicationContext) renders the Application Selector instead of
//      guessing an application. This only happens when there is genuinely
//      no domain match, which never occurs for a real, configured
//      production domain -- Core stays invisible to end users.
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
  overrideSlug: z.string().min(1).optional(),
});

export const resolveApplication = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => resolveApplicationSchema.parse(raw ?? {}))
  .handler(async ({ data }): Promise<ApplicationBranding | null> => {
    const request = getRequest();
    const hostname = extractHostname(request?.headers.get("host") ?? null);

    let row = hostname ? await findByDomain(hostname) : null;

    if (!row && data.overrideSlug) {
      row = await findBySlug(data.overrideSlug);
      if (row) {
        setCookie(APP_OVERRIDE_COOKIE, row.slug, {
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
          sameSite: "lax",
        });
      }
    }

    if (!row) {
      const cookieSlug = getCookie(APP_OVERRIDE_COOKIE);
      if (cookieSlug) row = await findBySlug(cookieSlug);
    }

    return row ? toBranding(row) : null;
  });
