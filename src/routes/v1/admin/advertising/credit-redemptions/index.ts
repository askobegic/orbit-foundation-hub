// API_CONTRACT.md §14 -- GET /v1/admin/advertising/credit-redemptions?status=pending.
// Replicates adminListPendingAdvertisingCreditRedemptions
// (advertising.functions.ts) -- filtered in application code since this
// list is small/admin-only, not a hot path.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/advertising/credit-redemptions/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const url = new URL(request.url);
        const status = url.searchParams.get("status") ?? "pending";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("reward_redemptions")
          .select("*, profiles(username, first_name, last_name)")
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);

        const filtered = (data ?? []).filter((r) => {
          const g = r.grant_result as { status?: string; grantType?: string } | null;
          if (g?.grantType !== "advertising_credit") return false;
          const rowStatus = g?.status ?? "pending_fulfillment";
          return (
            status === "all" ||
            rowStatus === (status === "pending" ? "pending_fulfillment" : status)
          );
        });

        return apiData(
          filtered.map((r) => {
            const g = r.grant_result as {
              status?: string;
              grantValue?: { amount?: number; currency?: string };
            } | null;
            return {
              redemptionId: r.id,
              userId: r.user_id,
              userName:
                [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(" ") ||
                r.profiles?.username,
              amount: g?.grantValue?.amount ?? null,
              currency: g?.grantValue?.currency ?? null,
              status: g?.status ?? "pending_fulfillment",
              createdAt: r.created_at,
            };
          }),
        );
      }),
    },
  },
});
