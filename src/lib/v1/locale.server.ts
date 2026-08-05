// Priority 8.11: API_CONTRACT.md §4.9 -- the one Localization resolution
// order, applied by every /v1 handler that returns a field resolved from
// more than one stored locale (plan features, notification copy, etc.),
// never re-derived per endpoint. Order: (1) Accept-Language header, (2) the
// signed-in caller's own profiles.language, (3) the calling application's
// default_language, (4) English, unconditionally.
import type { SupabaseClient } from "@supabase/supabase-js";

export type SupportedLocale = "bs" | "en" | "de";
const SUPPORTED: readonly string[] = ["bs", "en", "de"];

function isSupported(value: unknown): value is SupportedLocale {
  return typeof value === "string" && SUPPORTED.includes(value);
}

function parseAcceptLanguage(header: string | null): SupportedLocale[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase().slice(0, 2))
    .filter(isSupported);
}

export async function resolveLocale(params: {
  request: Request;
  supabaseAdmin: SupabaseClient;
  userId?: string | null;
  appId?: string | null;
}): Promise<SupportedLocale> {
  const fromHeader = parseAcceptLanguage(params.request.headers.get("accept-language"))[0];
  if (fromHeader) return fromHeader;

  if (params.userId) {
    const { data } = await params.supabaseAdmin
      .from("profiles")
      .select("language")
      .eq("id", params.userId)
      .maybeSingle();
    if (isSupported(data?.language)) return data.language;
  }

  if (params.appId) {
    const { data } = await params.supabaseAdmin
      .from("applications")
      .select("default_language")
      .eq("id", params.appId)
      .maybeSingle();
    if (isSupported(data?.default_language)) return data.default_language;
  }

  return "en";
}

// Picks `${field}_${locale}` off a row shaped like the existing `_bs`/`_en`/
// `_de` column triplets -- never returns the raw triplet itself (Design
// Principle 1).
export function pickLocalized(
  row: Record<string, unknown>,
  field: string,
  locale: SupportedLocale,
): string | null {
  const value = row[`${field}_${locale}`];
  return typeof value === "string" && value.length > 0 ? value : null;
}
