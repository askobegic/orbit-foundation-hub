// API_CONTRACT.md §7 -- PATCH /v1/admin/applications/{appId}.
// Branding/settings only -- visibility is deliberately not part of this
// schema, see visibility.ts in this same folder.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { appSlugSchema, domainSchema } from "@/lib/admin.functions";
import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";
import type { Database } from "@/integrations/supabase/types";
import type { ApplicationRow } from "@/types/database";

type ApplicationUpdate = Database["public"]["Tables"]["applications"]["Update"];

const bodySchema = z.object({
  name: z.string().min(1).optional(),
  slug: appSlugSchema.optional(),
  domain: domainSchema,
  primaryColor: z.string().min(1).optional(),
  secondaryColor: z.string().min(1).optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  sortOrder: z.number().int().optional(),
  logoUrl: z.string().url().nullable().optional(),
  faviconUrl: z.string().url().nullable().optional(),
  googleClientId: z.string().min(1).nullable().optional(),
  shortDescriptionBs: z.string().max(160).nullable().optional(),
  shortDescriptionEn: z.string().max(160).nullable().optional(),
  shortDescriptionDe: z.string().max(160).nullable().optional(),
  launchDate: z.string().datetime().nullable().optional(),
  defaultLanguage: z.enum(["bs", "en", "de"]).nullable().optional(),
});

function toApplication(row: ApplicationRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    domain: row.domain,
    logoUrl: row.logo_url,
    faviconUrl: row.favicon_url,
    coverImageUrl: row.cover_image_url,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    googleClientId: row.google_client_id,
    defaultLanguage: row.default_language,
    visibility: row.visibility,
    launchDate: row.launch_date,
    sortOrder: row.sort_order,
  };
}

export const Route = createFileRoute("/v1/admin/applications/$appId/")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const patch: ApplicationUpdate = {};
        if (data.name !== undefined) patch.name = data.name;
        if (data.slug !== undefined) patch.slug = data.slug;
        if (data.domain !== undefined) patch.domain = data.domain;
        if (data.primaryColor !== undefined) patch.primary_color = data.primaryColor;
        if (data.secondaryColor !== undefined) patch.secondary_color = data.secondaryColor;
        if (data.coverImageUrl !== undefined) patch.cover_image_url = data.coverImageUrl;
        if (data.sortOrder !== undefined) patch.sort_order = data.sortOrder;
        if (data.logoUrl !== undefined) patch.logo_url = data.logoUrl;
        if (data.faviconUrl !== undefined) patch.favicon_url = data.faviconUrl;
        if (data.googleClientId !== undefined) patch.google_client_id = data.googleClientId;
        if (data.shortDescriptionBs !== undefined)
          patch.short_description_bs = data.shortDescriptionBs;
        if (data.shortDescriptionEn !== undefined)
          patch.short_description_en = data.shortDescriptionEn;
        if (data.shortDescriptionDe !== undefined)
          patch.short_description_de = data.shortDescriptionDe;
        if (data.launchDate !== undefined) patch.launch_date = data.launchDate;
        if (data.defaultLanguage !== undefined) patch.default_language = data.defaultLanguage;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("applications")
          .update(patch)
          .eq("id", params.appId)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "app.settings_update",
          entityType: "application",
          entityId: params.appId,
          newData: patch,
        });

        return apiData(toApplication(row as ApplicationRow));
      }),
    },
  },
});
