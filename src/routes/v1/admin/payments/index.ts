// API_CONTRACT.md §12 -- GET /v1/admin/payments.
import { createFileRoute } from "@tanstack/react-router";

import { apiList, decodeCursor, encodeCursor, parseLimit, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/payments/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const limit = parseLimit(url);
        const cursor = decodeCursor<{ createdAt: string }>(url.searchParams.get("cursor"));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let query = supabaseAdmin
          .from("payments")
          .select(
            "id, amount, currency, status, payment_method, created_at, profiles(username, first_name, last_name)",
          )
          .order("created_at", { ascending: false })
          .limit(limit + 1);
        if (status) query = query.eq("status", status);
        if (cursor) query = query.lt("created_at", cursor.createdAt);

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const rows = data ?? [];
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;

        return apiList(
          page.map((p) => ({
            id: p.id,
            amount: Number(p.amount),
            currency: p.currency,
            status: p.status,
            paymentMethod: p.payment_method,
            userName:
              [p.profiles?.first_name, p.profiles?.last_name].filter(Boolean).join(" ") ||
              p.profiles?.username,
            createdAt: p.created_at,
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
