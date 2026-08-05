// API_CONTRACT.md §9 -- GET /v1/dashboard/widgets.
import { createFileRoute } from "@tanstack/react-router";

import { getDashboardWidgets } from "@/lib/dashboard-widgets.functions";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/dashboard/widgets/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const keys = await getDashboardWidgets({ data: { appId: ctx.appId } });
        return apiData(keys);
      }),
    },
  },
});
