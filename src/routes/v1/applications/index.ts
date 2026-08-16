// API_CONTRACT.md §7 -- GET /v1/applications.
// Automatically filtered to what the requesting caller is allowed to see
// (§7.1) -- never a caller-supplied filter.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { optionalUserContext } from "@/lib/v1/context.server";
import { pickLocalized, resolveLocale, type SupportedLocale } from "@/lib/v1/locale.server";
import type { ApplicationRow } from "@/types/database";

function toListItem(app: ApplicationRow, locale: SupportedLocale) {
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    logoUrl: app.logo_url,
    faviconUrl: app.favicon_url,
    coverImageUrl: app.cover_image_url,
    primaryColor: app.primary_color,
    secondaryColor: app.secondary_color,
    visibility: app.visibility,
    launchDate: app.launch_date,
    launchStatus: app.launch_status,
    shortDescription:
      pickLocalized(app as unknown as Record<string, unknown>, "short_description", locale) ??
      app.short_description_en,
  };
}

export const Route = createFileRoute("/v1/applications/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
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

        let query = supabaseAdmin
          .from("applications")
          .select("*")
          .order("sort_order", { ascending: true });
        if (!isAdmin) query = query.in("visibility", ["coming_soon", "active"]);
        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const locale = await resolveLocale({
          request,
          supabaseAdmin,
          userId: ctx?.userId ?? null,
          appId: ctx?.appId ?? null,
        });

        return apiData(((data ?? []) as ApplicationRow[]).map((a) => toListItem(a, locale)));
      }),
    },
  },
});
