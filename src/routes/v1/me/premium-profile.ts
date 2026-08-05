// API_CONTRACT.md §6 -- GET/PATCH /v1/me/premium-profile.
// Editable regardless of Premium status (PROJECT_KNOWLEDGE.md: "Profile
// editing is never Premium-gated").
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { isSafeProfileUrl } from "@/lib/url";
import { apiData, ApiError, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";
import type { PremiumProfileRow } from "@/types/database";

function toPremiumProfile(row: PremiumProfileRow | null) {
  return {
    phone: row?.phone ?? null,
    phonePublic: row?.phone_public ?? false,
    whatsapp: row?.whatsapp ?? null,
    whatsappPublic: row?.whatsapp_public ?? false,
    contactEmail: row?.contact_email ?? null,
    contactEmailPublic: row?.contact_email_public ?? false,
    website: row?.website ?? null,
    websitePublic: row?.website_public ?? false,
    primaryProfession: row?.primary_profession ?? null,
    secondaryProfessions: row?.secondary_professions ?? [],
    facebookUrl: row?.facebook_url ?? null,
    instagramUrl: row?.instagram_url ?? null,
    tiktokUrl: row?.tiktok_url ?? null,
    youtubeUrl: row?.youtube_url ?? null,
    linkedinUrl: row?.linkedin_url ?? null,
    xUrl: row?.x_url ?? null,
  };
}

const urlField = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine((v) => !v || isSafeProfileUrl(v), { message: "Only http/https URLs are allowed" });

const patchSchema = z.object({
  phone: z.string().trim().nullable().optional(),
  phonePublic: z.boolean().optional(),
  whatsapp: z.string().trim().nullable().optional(),
  whatsappPublic: z.boolean().optional(),
  contactEmail: z.string().trim().email().nullable().optional(),
  contactEmailPublic: z.boolean().optional(),
  website: urlField,
  websitePublic: z.boolean().optional(),
  primaryProfession: z.string().trim().nullable().optional(),
  secondaryProfessions: z.array(z.string().trim()).optional(),
  facebookUrl: urlField,
  instagramUrl: urlField,
  tiktokUrl: urlField,
  youtubeUrl: urlField,
  linkedinUrl: urlField,
  xUrl: urlField,
});

export const Route = createFileRoute("/v1/me/premium-profile")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("premium_profiles")
          .select("*")
          .eq("user_id", ctx.userId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return apiData(toPremiumProfile(data as PremiumProfileRow | null));
      }),

      PATCH: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const patch: Record<string, unknown> = {};
        if (data.phone !== undefined) patch.phone = data.phone;
        if (data.phonePublic !== undefined) patch.phone_public = data.phonePublic;
        if (data.whatsapp !== undefined) patch.whatsapp = data.whatsapp;
        if (data.whatsappPublic !== undefined) patch.whatsapp_public = data.whatsappPublic;
        if (data.contactEmail !== undefined) patch.contact_email = data.contactEmail;
        if (data.contactEmailPublic !== undefined)
          patch.contact_email_public = data.contactEmailPublic;
        if (data.website !== undefined) patch.website = data.website;
        if (data.websitePublic !== undefined) patch.website_public = data.websitePublic;
        if (data.primaryProfession !== undefined) patch.primary_profession = data.primaryProfession;
        if (data.secondaryProfessions !== undefined)
          patch.secondary_professions = data.secondaryProfessions;
        if (data.facebookUrl !== undefined) patch.facebook_url = data.facebookUrl;
        if (data.instagramUrl !== undefined) patch.instagram_url = data.instagramUrl;
        if (data.tiktokUrl !== undefined) patch.tiktok_url = data.tiktokUrl;
        if (data.youtubeUrl !== undefined) patch.youtube_url = data.youtubeUrl;
        if (data.linkedinUrl !== undefined) patch.linkedin_url = data.linkedinUrl;
        if (data.xUrl !== undefined) patch.x_url = data.xUrl;

        if (Object.keys(patch).length === 0) {
          throw new ApiError("VALIDATION_ERROR", "No fields to update");
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("premium_profiles")
          .upsert({ user_id: ctx.userId, ...patch }, { onConflict: "user_id" })
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        return apiData(toPremiumProfile(row as PremiumProfileRow));
      }),
    },
  },
});
