// API_CONTRACT.md §10 -- GET /v1/me/premium. A direct pass-through of the
// one shared resolver (premium.server.ts) -- Design Principle 5.
import { createFileRoute } from "@tanstack/react-router";

import { resolvePremiumStatus } from "@/lib/premium.server";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/premium")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const status = await resolvePremiumStatus(supabaseAdmin, ctx.userId);
        return apiData({
          active: status.active,
          source: status.source,
          expiresAt: status.expiresAt,
        });
      }),
    },
  },
});
