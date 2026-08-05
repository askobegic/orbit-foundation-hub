// API_CONTRACT.md §13 -- GET /v1/admin/rewards/config.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/rewards/config/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("reward_config")
          .select("*")
          .order("key", { ascending: true });
        if (error) throw new Error(error.message);
        return apiData((data ?? []).map((r) => ({ key: r.key, value: r.value })));
      }),
    },
  },
});
