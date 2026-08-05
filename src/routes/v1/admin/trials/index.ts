// API_CONTRACT.md §11 -- GET /v1/admin/trials.
import { createFileRoute } from "@tanstack/react-router";

import { apiList, decodeCursor, encodeCursor, parseLimit, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/trials/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const url = new URL(request.url);
        const userId = url.searchParams.get("userId");
        const limit = parseLimit(url);
        const cursor = decodeCursor<{ createdAt: string }>(url.searchParams.get("cursor"));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let query = supabaseAdmin
          .from("promotional_trials")
          .select(
            "*, profiles!promotional_trials_user_id_fkey(username, first_name, last_name), granted_by_profile:profiles!promotional_trials_granted_by_fkey(username, first_name, last_name)",
          )
          .order("created_at", { ascending: false })
          .limit(limit + 1);
        if (userId) query = query.eq("user_id", userId);
        if (cursor) query = query.lt("created_at", cursor.createdAt);

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const rows = data ?? [];
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        return apiList(
          page.map((r) => ({
            id: r.id,
            userId: r.user_id,
            userName:
              [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(" ") ||
              r.profiles?.username,
            status: r.status,
            source: r.source,
            startsAt: r.starts_at,
            expiresAt: r.expires_at,
            endedAt: r.ended_at,
            grantedBy: r.granted_by_profile?.username ?? null,
            reason: r.reason,
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
