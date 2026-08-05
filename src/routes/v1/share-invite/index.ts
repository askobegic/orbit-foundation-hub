// API_CONTRACT.md §15 -- GET /v1/share-invite. Reuses getShareInviteConfig
// directly (share-invite.functions.ts) -- middleware-less createServerFn,
// safe to call as a plain function.
import { createFileRoute } from "@tanstack/react-router";

import { getShareInviteConfig } from "@/lib/share-invite.functions";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { resolveAppId } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/share-invite/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const url = new URL(request.url);
        const appId = await resolveAppId(request, url, { required: true });
        const config = await getShareInviteConfig({ data: { appId: appId! } });
        return apiData(config);
      }),
    },
  },
});
