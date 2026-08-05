// API_CONTRACT.md §7 -- POST /v1/admin/applications.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { appSlugSchema, domainSchema } from "@/lib/admin.functions";
import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";
import type { ApplicationRow } from "@/types/database";

const bodySchema = z.object({
  name: z.string().min(1),
  slug: appSlugSchema,
  domain: domainSchema,
  primaryColor: z.string().min(1).optional(),
  secondaryColor: z.string().min(1).optional(),
  googleClientId: z.string().min(1).nullable().optional(),
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

export const Route = createFileRoute("/v1/admin/applications/")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // visibility defaults to 'draft' (the column's own DB default) --
        // never accepted here, matching adminCreateApplication exactly.
        const { data: row, error } = await supabaseAdmin
          .from("applications")
          .insert({
            name: data.name,
            slug: data.slug,
            domain: data.domain ?? null,
            primary_color: data.primaryColor,
            secondary_color: data.secondaryColor,
            google_client_id: data.googleClientId ?? null,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "application.create",
          entityType: "application",
          entityId: row.id,
          newData: row,
        });

        return apiData(toApplication(row as ApplicationRow), 201);
      }),
    },
  },
});
