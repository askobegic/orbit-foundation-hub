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
import { clientIp, enforceRateLimit } from "@/lib/rate-limit.server";

const bodySchema = z.object({
  googleIdToken: z.string().trim().min(1),
  appId: z.string().uuid(),
});

export const Route = createFileRoute("/v1/auth/session")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        // Priority 11 security audit: no rate limiting existed on this
        // endpoint. 20 attempts/5min per IP is generous for legitimate use
        // (one sign-in is one call) while bounding scripted abuse.
        enforceRateLimit(`auth-session:${clientIp(request)}`, 20, 5 * 60 * 1000);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: app } = await supabaseAdmin
          .from("applications")
          .select("id, visibility")
          .eq("id", data.appId)
          .maybeSingle();
        if (!app) {
          throw new ApiError(
            "VALIDATION_ERROR",
            "appId does not resolve to a registered application",
            [{ field: "appId", issue: "not_found" }],
          );
        }
        // archived = retired, per PROJECT_KNOWLEDGE.md -> Application
        // Visibility. draft/coming_soon are deliberately still allowed to
        // mint sessions -- draft also covers Core's own permanently-hidden-
        // from-the-dashboard-but-fully-functional application row (see
        // PROJECT_AUDIT.md), and coming_soon applications legitimately need
        // to authenticate for pre-launch testing.
        if (app.visibility === "archived") {
          throw new ApiError(
            "VALIDATION_ERROR",
            "This application is archived and no longer accepts sign-ins",
            [{ field: "appId", issue: "archived" }],
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
