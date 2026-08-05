// API_CONTRACT.md §5 -- POST /v1/auth/session.
//
// Exchanges a Google ID token for a unified CORE session. Internally this
// is the exact same signInWithIdToken() verification Supabase already
// performs today (AuthContext.tsx) -- this endpoint does not introduce a
// second identity-verification path, only wraps the result in a
// CORE-minted token pair. The `appId` supplied here becomes the resulting
// access token's `azp` claim (§3.1) for the lifetime of this session.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { ensureProfile } from "@/lib/identity.server";
import { mintAccessToken } from "@/lib/v1/jwt.server";
import { issueRefreshToken } from "@/lib/v1/refresh-token.server";

const bodySchema = z.object({
  googleIdToken: z.string().trim().min(1),
  appId: z.string().uuid(),
});

export const Route = createFileRoute("/v1/auth/session")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: app } = await supabaseAdmin
          .from("applications")
          .select("id")
          .eq("id", data.appId)
          .maybeSingle();
        if (!app) {
          throw new ApiError(
            "VALIDATION_ERROR",
            "appId does not resolve to a registered application",
            [{ field: "appId", issue: "not_found" }],
          );
        }

        const { supabase } = await import("@/integrations/supabase/client");
        const { data: signInData, error: signInError } = await supabase.auth.signInWithIdToken({
          provider: "google",
          token: data.googleIdToken,
        });
        if (signInError || !signInData.user) {
          throw new ApiError("VALIDATION_ERROR", "Invalid or expired Google ID token", [
            { field: "googleIdToken", issue: "invalid" },
          ]);
        }

        const { isNewUser } = await ensureProfile(supabaseAdmin, signInData.user);

        const [{ token: accessToken, expiresIn }, refreshToken] = await Promise.all([
          mintAccessToken(signInData.user.id, data.appId),
          issueRefreshToken(supabaseAdmin, signInData.user.id, data.appId),
        ]);

        return apiData({
          accessToken,
          refreshToken,
          expiresIn,
          user: { id: signInData.user.id, isNewUser },
        });
      }),
    },
  },
});
