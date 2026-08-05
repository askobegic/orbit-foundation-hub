// API_CONTRACT.md §8 -- GET /v1/capabilities.
// Reuses getApplicationCapabilities() directly (public, middleware-less --
// safe to call as a plain function, exactly like advertising.functions.ts
// already does internally) -- never re-derived.
import { createFileRoute } from "@tanstack/react-router";

import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { resolveAppId } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/capabilities/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const url = new URL(request.url);
        const appId = await resolveAppId(request, url, { required: true });
        const keys = await getApplicationCapabilities({ data: { appId: appId! } });
        return apiData(keys);
      }),
    },
  },
});
