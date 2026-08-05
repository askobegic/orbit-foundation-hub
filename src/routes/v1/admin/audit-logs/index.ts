// API_CONTRACT.md §19 -- GET /v1/admin/audit-logs. Cursor pagination
// (§4.2), replacing adminListAuditLogs's fixed limit(50) with the standard
// /v1 list shape; oldData/newData passed through as-is -- already-recorded
// JSON snapshots, never re-shaped.
import { createFileRoute } from "@tanstack/react-router";

import { apiList, decodeCursor, encodeCursor, parseLimit, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/audit-logs/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const url = new URL(request.url);
        const entityType = url.searchParams.get("entityType");
        const limit = parseLimit(url);
        const cursor = decodeCursor<{ createdAt: string }>(url.searchParams.get("cursor"));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let query = supabaseAdmin
          .from("audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit + 1);
        if (entityType) query = query.eq("entity_type", entityType);
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
            action: r.action,
            entityType: r.entity_type,
            entityId: r.entity_id,
            oldData: r.old_data,
            newData: r.new_data,
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
