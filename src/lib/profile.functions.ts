// CORE Universal Premium-Locked Content -- the public profile page's own
// secure data fetch. Replaces u.$username.tsx's previous direct
// `profiles_public`/`premium_profiles_public` browser queries, which
// returned every Contact Actions value (WhatsApp/phone/email/website) to
// every visitor's browser state regardless of Premium eligibility, relying
// on ProfileCard.tsx's client-side `canContact` check to merely hide the
// value visually. That is exactly the "send value, hide with CSS/JS"
// anti-pattern CORE forbids -- the server must decide whether the value may
// be returned at all (PROJECT_KNOWLEDGE.md -> Premium-Locked Content).
//
// This mirrors the same eligibility rules /v1/profiles/$username.ts already
// enforces correctly (owner must hold active Global Premium for the card to
// render as Premium at all; a viewer may see the real contact values only
// with active Global Premium of their own AND the owner's is_contactable
// flag for the current application) -- that endpoint is untouched, since it
// already gets this right; this file exists because the CORE web app's own
// page never went through it. The generic eligibility check itself
// (isContentUnlocked) lives in content-lock.server.ts, reused rather than
// re-derived here.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import {
  isContentUnlocked,
  resolveLockableField,
  type LockableField,
} from "@/lib/content-lock.server";
import { resolvePremiumStatus } from "@/lib/premium.server";
import { isSafeProfileUrl } from "@/lib/url";
import type { PremiumProfileRow, ProfileRow } from "@/types/database";

// Non-throwing counterpart to the generated requireSupabaseAuth middleware
// (src/integrations/supabase/auth-middleware.ts, "do not edit it
// directly") -- this route must keep working for a signed-out visitor, so
// a missing/invalid token falls through to anonymous behavior instead of
// rejecting the request. Verifies the caller's own Supabase-issued token
// server-side via the admin client's auth endpoint; a viewer id is never
// accepted as a plain client-supplied parameter (that would let anyone
// claim to be a Premium user to unlock someone else's contact info).
async function resolveViewerId(supabaseAdmin: {
  auth: { getUser: (jwt: string) => Promise<{ data: { user: { id: string } | null } }> };
}): Promise<string | null> {
  const request = getRequest();
  const authHeader = request?.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token.split(".").length !== 3) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  return data.user?.id ?? null;
}

const SOCIAL_FIELDS = [
  ["facebook", "facebook_url"],
  ["instagram", "instagram_url"],
  ["tiktok", "tiktok_url"],
  ["youtube", "youtube_url"],
  ["linkedin", "linkedin_url"],
  ["x", "x_url"],
] as const;

export type PublicProfileTier = "standard" | "premium";

export type PublicProfileBundle = {
  profile: Pick<
    ProfileRow,
    | "id"
    | "username"
    | "first_name"
    | "last_name"
    | "avatar_url"
    | "city"
    | "country"
    | "is_verified"
  >;
  tier: PublicProfileTier;
  isOwnerContactableHere: boolean;
  canContact: boolean;
  primaryProfession: string | null;
  secondaryProfessions: string[];
  whatsapp: LockableField;
  phone: LockableField;
  contactEmail: LockableField;
  website: LockableField;
  socials: Record<(typeof SOCIAL_FIELDS)[number][0], LockableField>;
};

const inputSchema = z.object({
  username: z.string().trim().min(1),
  // null when the caller isn't browsing on a resolved CORE application
  // (e.g. the bare CORE domain) -- mirrors u.$username.tsx's pre-existing
  // "no application" fallback (treat as visible/contactable, skip the
  // per-application gate entirely) rather than inventing new behavior.
  appId: z.string().uuid().nullable(),
});

// Public, deliberately not behind requireSupabaseAuth -- the page it backs
// is browsable while signed out. A non-null `appId` is validated against a
// real, registered application below for every caller (this function has
// no verified-JWT `azp` claim to trust the way the /v1 API does), matching
// the same defensive precedent /v1/profiles/$username.ts already sets for
// its own anonymous callers.
export const getPublicProfileForViewer = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => inputSchema.parse(raw))
  .handler(async ({ data }): Promise<PublicProfileBundle | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.appId) {
      const { data: appRow } = await supabaseAdmin
        .from("applications")
        .select("id")
        .eq("id", data.appId)
        .maybeSingle();
      if (!appRow) return null;
    }

    const { data: profileRow, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, first_name, last_name, avatar_url, city, country, is_verified")
      .eq("username", data.username)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const owner = profileRow as PublicProfileBundle["profile"] | null;
    if (!owner) return null;

    const appSetting = data.appId
      ? (
          await supabaseAdmin
            .from("user_app_settings")
            .select("is_visible, is_contactable")
            .eq("user_id", owner.id)
            .eq("app_id", data.appId)
            .maybeSingle()
        ).data
      : null;
    if (!(appSetting?.is_visible ?? true)) return null;

    const ownerPremium = await resolvePremiumStatus(supabaseAdmin, owner.id);
    const isOwnerContactableHere = appSetting?.is_contactable ?? true;

    if (!ownerPremium.active) {
      return {
        profile: owner,
        tier: "standard",
        isOwnerContactableHere,
        canContact: false,
        primaryProfession: null,
        secondaryProfessions: [],
        whatsapp: { exists: false, locked: false, value: null },
        phone: { exists: false, locked: false, value: null },
        contactEmail: { exists: false, locked: false, value: null },
        website: { exists: false, locked: false, value: null },
        socials: Object.fromEntries(
          SOCIAL_FIELDS.map(([label]) => [label, { exists: false, locked: false, value: null }]),
        ) as PublicProfileBundle["socials"],
      };
    }

    const viewerId = await resolveViewerId(supabaseAdmin);
    // Contact Actions eligibility (Priority 6/8.7): both sides need active
    // Global Premium, plus the owner must not have turned off contact for
    // the application currently being browsed -- unchanged from the
    // existing model, just evaluated server-side here through the shared
    // generic primitive instead of re-derived.
    const viewerUnlocked = await isContentUnlocked(supabaseAdmin, viewerId, [
      { type: "global_premium" },
    ]);
    const canContact = viewerUnlocked && isOwnerContactableHere;

    const { data: premiumProfileRow } = await supabaseAdmin
      .from("premium_profiles")
      .select("*")
      .eq("user_id", owner.id)
      .maybeSingle();
    const pp = premiumProfileRow as PremiumProfileRow | null;

    const website =
      pp?.website_public && pp.website && isSafeProfileUrl(pp.website) ? pp.website : null;

    const socials = Object.fromEntries(
      SOCIAL_FIELDS.map(([label, column]) => {
        const raw = pp?.[column];
        const value = typeof raw === "string" && raw && isSafeProfileUrl(raw) ? raw : null;
        return [label, resolveLockableField(value, canContact)];
      }),
    ) as PublicProfileBundle["socials"];

    return {
      profile: owner,
      tier: "premium",
      isOwnerContactableHere,
      canContact,
      primaryProfession: pp?.primary_profession ?? null,
      secondaryProfessions: pp?.secondary_professions ?? [],
      whatsapp: resolveLockableField(pp?.whatsapp_public ? pp.whatsapp : null, canContact),
      phone: resolveLockableField(pp?.phone_public ? pp.phone : null, canContact),
      contactEmail: resolveLockableField(
        pp?.contact_email_public ? pp.contact_email : null,
        canContact,
      ),
      website: resolveLockableField(website, canContact),
      socials,
    };
  });
