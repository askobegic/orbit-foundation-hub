// API_CONTRACT.md §5 -- POST /v1/auth/logout.
//
// "everywhere: false" (default) revokes every refresh token for the
// caller's current (user, app) pair -- the closest available meaning of
// "current session" without the stateless access token itself carrying a
// refresh-token reference (deliberate, §3.1). "everywhere: true" revokes
// every refresh token for this user, across every application.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";
import {
  revokeAllRefreshTokensForUser,
  revokeRefreshTokensForApp,
} from "@/lib/v1/refresh-token.server";

const bodySchema = z.object({ everywhere: z.boolean().default(false) });

export const Route = createFileRoute("/v1/auth/logout")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (data.everywhere) {
          await revokeAllRefreshTokensForUser(supabaseAdmin, ctx.userId);
        } else {
          await revokeRefreshTokensForApp(supabaseAdmin, ctx.userId, ctx.appId);
        }

        return apiData({ ok: true });
      }),
    },
  },
});
