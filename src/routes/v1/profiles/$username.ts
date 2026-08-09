// API_CONTRACT.md §6 -- GET /v1/profiles/{username}. The public profile
// bundle -- mirrors what u.$username.tsx/ProfileCard.tsx assemble today.
// Premium status resolved exclusively through the shared resolver
// (premium.server.ts), never re-derived (Design Principle 5).
import { createFileRoute } from "@tanstack/react-router";

import { resolvePremiumStatus } from "@/lib/premium.server";
import { isSafeProfileUrl } from "@/lib/url";
import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { optionalUserContext } from "@/lib/v1/context.server";
import type { PremiumProfileRow, ProfileRow } from "@/types/database";

const SOCIAL_FIELDS = [
  ["facebook", "facebook_url"],
  ["instagram", "instagram_url"],
  ["tiktok", "tiktok_url"],
  ["youtube", "youtube_url"],
  ["linkedin", "linkedin_url"],
  ["x", "x_url"],
] as const;

export const Route = createFileRoute("/v1/profiles/$username")({
  server: {
    handlers: {
      GET: withRoute(async ({ request, params }) => {
        const url = new URL(request.url);
        const viewer = await optionalUserContext(request);
        const appId = viewer?.appId ?? url.searchParams.get("appId");
        if (!appId) {
          throw new ApiError("VALIDATION_ERROR", "appId is required", [
            { field: "appId", issue: "required" },
          ]);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // An authenticated viewer's appId is already trustworthy (it comes
        // from their verified JWT's azp claim). An anonymous caller's is
        // client-supplied, so it's validated here -- otherwise a bogus
        // appId guarantees no matching user_app_settings row below, and
        // the per-application visibility gate silently defaults to
        // visible regardless of what the profile owner actually
        // configured on any real application (Priority 11 security audit).
        if (!viewer) {
          const { data: appRow } = await supabaseAdmin
            .from("applications")
            .select("id")
            .eq("id", appId)
            .maybeSingle();
          if (!appRow) {
            throw new ApiError("VALIDATION_ERROR", "appId does not resolve to a registered application", [
              { field: "appId", issue: "not_found" },
            ]);
          }
        }

        const { data: profile, error } = await supabaseAdmin
          .from("profiles")
          .select("*")
          .eq("username", params.username)
          .eq("is_active", true)
          .maybeSingle();
        if (error) throw new Error(error.message);
        const owner = profile as ProfileRow | null;
        if (!owner) throw new ApiError("NOT_FOUND", "Profile not found");

        const { data: appSetting } = await supabaseAdmin
          .from("user_app_settings")
          .select("is_visible, is_contactable")
          .eq("user_id", owner.id)
          .eq("app_id", appId)
          .maybeSingle();
        const isVisible = appSetting?.is_visible ?? true;
        if (!isVisible) throw new ApiError("NOT_FOUND", "Profile not found");

        const ownerPremium = await resolvePremiumStatus(supabaseAdmin, owner.id);
        if (!ownerPremium.active) {
          return apiData({
            username: owner.username,
            tier: "standard",
            firstName: owner.first_name,
            lastName: owner.last_name,
            avatarUrl: owner.avatar_url,
            city: owner.city,
            country: owner.country,
            memberSince: owner.created_at,
          });
        }

        const isOwnerContactableHere = appSetting?.is_contactable ?? true;
        const viewerPremium = viewer
          ? await resolvePremiumStatus(supabaseAdmin, viewer.userId)
          : null;
        const canContact = !!viewerPremium?.active && isOwnerContactableHere;

        const { data: premiumProfile } = await supabaseAdmin
          .from("premium_profiles")
          .select("*")
          .eq("user_id", owner.id)
          .maybeSingle();
        const pp = premiumProfile as PremiumProfileRow | null;

        const { data: visibleRows } = await supabaseAdmin
          .from("user_app_settings")
          .select("app_id, applications(id, name, slug)")
          .eq("user_id", owner.id)
          .eq("is_visible", true);
        const visibleOnApplications = (visibleRows ?? [])
          .map(
            (r) =>
              (r as { applications?: { id: string; name: string; slug: string } }).applications,
          )
          .filter((a): a is { id: string; name: string; slug: string } => !!a)
          .map((a) => ({ appId: a.id, appName: a.name, slug: a.slug }));

        const socials: Record<string, string | null> = {};
        for (const [label, column] of SOCIAL_FIELDS) {
          const value = pp?.[column as keyof PremiumProfileRow];
          if (typeof value === "string" && value && isSafeProfileUrl(value)) socials[label] = value;
        }

        const contactActions = canContact
          ? {
              call: pp?.phone_public ? pp.phone : null,
              whatsapp: pp?.whatsapp_public ? pp.whatsapp : null,
              viber: pp?.phone_public ? pp.phone : null,
              email: pp?.contact_email_public ? pp.contact_email : null,
              website:
                pp?.website_public && pp.website && isSafeProfileUrl(pp.website)
                  ? pp.website
                  : null,
              socials,
              sendMessage: true,
            }
          : {
              call: null,
              whatsapp: null,
              viber: null,
              email: null,
              website: null,
              socials: {},
              sendMessage: false,
              locked: true,
            };

        return apiData({
          username: owner.username,
          tier: "premium",
          firstName: owner.first_name,
          lastName: owner.last_name,
          avatarUrl: owner.avatar_url,
          city: owner.city,
          country: owner.country,
          isVerified: owner.is_verified,
          primaryProfession: pp?.primary_profession ?? null,
          secondaryProfessions: pp?.secondary_professions ?? [],
          visibleOnApplications,
          canContact,
          contactActions,
        });
      }),
    },
  },
});
