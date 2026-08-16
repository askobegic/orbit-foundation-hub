// API_CONTRACT.md §7 -- GET /v1/applications/{idOrSlug}.
import { createFileRoute } from "@tanstack/react-router";

import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { optionalUserContext } from "@/lib/v1/context.server";
import { resolveLocale } from "@/lib/v1/locale.server";
import type { ApplicationRow } from "@/types/database";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/v1/applications/$idOrSlug")({
  server: {
    handlers: {
      GET: withRoute(async ({ request, params }) => {
        const idOrSlug = params.idOrSlug;
        const ctx = await optionalUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let isAdmin = false;
        if (ctx) {
          const { assertAdmin } = await import("@/lib/admin.server");
          try {
            await assertAdmin(supabaseAdmin, ctx.userId);
            isAdmin = true;
          } catch {
            isAdmin = false;
          }
        }

        const { data: app, error } = await supabaseAdmin
          .from("applications")
          .select("*")
          .eq(UUID_RE.test(idOrSlug) ? "id" : "slug", idOrSlug)
          .maybeSingle();
        if (error) throw new Error(error.message);

        // §4.6: a draft/archived application looked up by a non-admin is
        // indistinguishable from one that doesn't exist at all.
        const row = app as ApplicationRow | null;
        if (!row || (!isAdmin && row.visibility !== "coming_soon" && row.visibility !== "active")) {
          throw new ApiError("NOT_FOUND", "Application not found");
        }

        const locale = await resolveLocale({
          request,
          supabaseAdmin,
          userId: ctx?.userId ?? null,
          appId: ctx?.appId ?? null,
        });
        const shortDescription =
          (locale === "bs"
            ? row.short_description_bs
            : locale === "de"
              ? row.short_description_de
              : row.short_description_en) ?? row.short_description_en;

        return apiData({
          id: row.id,
          name: row.name,
          slug: row.slug,
          logoUrl: row.logo_url,
          faviconUrl: row.favicon_url,
          coverImageUrl: row.cover_image_url,
          primaryColor: row.primary_color,
          secondaryColor: row.secondary_color,
          googleClientId: row.google_client_id,
          defaultLanguage: row.default_language,
          visibility: row.visibility,
          launchDate: row.launch_date,
          launchStatus: row.launch_status,
          shortDescription,
        });
      }),
    },
  },
});
