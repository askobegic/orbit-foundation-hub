// API_CONTRACT.md §19 -- GET /v1/admin/users. Replicates adminListUsers
// (admin.functions.ts) since it's a requireSupabaseAuth-middleware server
// function; resolvePremiumStatusBulk (premium.server.ts, plain function)
// reused directly so ?premium= includes Trial-only Premium users, exactly
// as the shared resolver defines it. Cursor pagination (§4.2) rather than
// adminListUsers' own page/pageSize, matching every other /v1 list endpoint.
import { createFileRoute } from "@tanstack/react-router";

import { resolvePremiumStatusBulk } from "@/lib/premium.server";
import { apiList, decodeCursor, encodeCursor, parseLimit, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/users/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const url = new URL(request.url);
        const search = url.searchParams.get("search");
        const premiumFilter = url.searchParams.get("premium");
        const isVerified = url.searchParams.get("isVerified");
        const isActive = url.searchParams.get("isActive");
        const limit = parseLimit(url);
        const cursor = decodeCursor<{ createdAt: string }>(url.searchParams.get("cursor"));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let premiumUserIds: string[] | null = null;
        if (premiumFilter !== null) {
          premiumUserIds = [...(await resolvePremiumStatusBulk(supabaseAdmin)).keys()];
        }

        let query = supabaseAdmin
          .from("profiles")
          .select(
            "id, email, first_name, last_name, username, city, country, is_verified, is_active, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(limit + 1);
        if (search) {
          const s = `%${search}%`;
          query = query.or(
            `email.ilike.${s},username.ilike.${s},first_name.ilike.${s},last_name.ilike.${s}`,
          );
        }
        if (premiumFilter === "true") {
          query = query.in(
            "id",
            premiumUserIds!.length > 0 ? premiumUserIds! : ["00000000-0000-0000-0000-000000000000"],
          );
        } else if (premiumFilter === "false") {
          if (premiumUserIds!.length > 0)
            query = query.not("id", "in", `(${premiumUserIds!.join(",")})`);
        }
        if (isVerified !== null) query = query.eq("is_verified", isVerified === "true");
        if (isActive !== null) query = query.eq("is_active", isActive === "true");
        if (cursor) query = query.lt("created_at", cursor.createdAt);

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const rows = data ?? [];
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        const pageIds = page.map((r) => r.id);
        const premiumOnPage = premiumUserIds
          ? new Set(premiumUserIds)
          : new Set((await resolvePremiumStatusBulk(supabaseAdmin, pageIds)).keys());

        return apiList(
          page.map((r) => ({
            id: r.id,
            email: r.email,
            firstName: r.first_name,
            lastName: r.last_name,
            username: r.username,
            city: r.city,
            country: r.country,
            isVerified: r.is_verified,
            isActive: r.is_active,
            isPremium: premiumOnPage.has(r.id),
            createdAt: r.created_at,
          })),
          {
            nextCursor: hasMore
              ? encodeCursor({ createdAt: page[page.length - 1].created_at })
              : null,
            hasMore,
          },
        );
      }),
    },
  },
});
