// API_CONTRACT.md §5 -- POST /v1/auth/refresh.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { mintAccessToken } from "@/lib/v1/jwt.server";
import { rotateRefreshToken } from "@/lib/v1/refresh-token.server";

const bodySchema = z.object({ refreshToken: z.string().trim().min(1) });

export const Route = createFileRoute("/v1/auth/refresh")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const rotated = await rotateRefreshToken(supabaseAdmin, data.refreshToken);
        if (!rotated) {
          throw new ApiError("UNAUTHORIZED", "Refresh token is invalid, expired, or already used");
        }

        const { token: accessToken, expiresIn } = await mintAccessToken(
          rotated.userId,
          rotated.appId,
        );
        return apiData({
          accessToken,
          refreshToken: rotated.refreshToken,
          expiresIn,
          // isNewUser is always false here -- a refresh never establishes a
          // new identity, only re-derives a token pair for an existing one.
          // Included for exact structural parity with /v1/auth/session's
          // response shape, per API_CONTRACT.md.
          user: { id: rotated.userId, isNewUser: false },
        });
      }),
    },
  },
});
