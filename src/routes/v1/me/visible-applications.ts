// API_CONTRACT.md §10 -- GET /v1/me/visible-applications.
import { createFileRoute } from "@tanstack/react-router";

import { getVisibleApplications } from "@/lib/premium";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/me/visible-applications")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const apps = await getVisibleApplications(ctx.userId);
        return apiData(apps.map((a) => ({ appId: a.id, appName: a.name, slug: a.slug })));
      }),
    },
  },
});
