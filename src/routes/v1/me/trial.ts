// API_CONTRACT.md §11 -- GET /v1/me/trial. Read-only.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/trial")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("promotional_trials")
          .select("*")
          .eq("user_id", ctx.userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return apiData(null);
        return apiData({
          id: data.id,
          status: data.status,
          source: data.source,
          startsAt: data.starts_at,
          expiresAt: data.expires_at,
          endedAt: data.ended_at,
        });
      }),
    },
  },
});
