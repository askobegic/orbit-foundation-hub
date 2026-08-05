// API_CONTRACT.md §12 -- GET /v1/admin/stats. Reuses
// resolvePremiumStatusBulk() directly (premium.server.ts) for
// activePremium -- Design Principle 5, never a re-derived count.
import { createFileRoute } from "@tanstack/react-router";

import { resolvePremiumStatusBulk } from "@/lib/premium.server";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/stats/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const [users, premiumStatuses, payments, newUsers] = await Promise.all([
          supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
          resolvePremiumStatusBulk(supabaseAdmin),
          supabaseAdmin
            .from("payments")
            .select("amount")
            .eq("status", "success")
            .gte("created_at", startOfMonth),
          supabaseAdmin
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .gte("created_at", weekAgo),
        ]);

        const revenue = (payments.data ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0);

        return apiData({
          totalUsers: users.count ?? 0,
          activePremium: premiumStatuses.size,
          revenueThisMonth: revenue,
          newUsersThisWeek: newUsers.count ?? 0,
        });
      }),
    },
  },
});
