// API_CONTRACT.md §13 -- POST /v1/me/referral. Replicates linkReferral
// (rewards.functions.ts) since it's a requireSupabaseAuth-middleware
// server function; grantRewardAction (rewards.server.ts) is reused
// directly, unchanged.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { grantRewardAction } from "@/lib/rewards.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

const bodySchema = z.object({ referrerUsername: z.string().trim().min(1) });

export const Route = createFileRoute("/v1/me/referral")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: me } = await supabaseAdmin
          .from("profiles")
          .select("referred_by_user_id")
          .eq("id", ctx.userId)
          .maybeSingle();
        if (me?.referred_by_user_id) return apiData({ linked: false, reason: "already_linked" });

        const { data: referrer } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("username", data.referrerUsername)
          .maybeSingle();
        if (!referrer) return apiData({ linked: false, reason: "referrer_not_found" });
        if (referrer.id === ctx.userId) return apiData({ linked: false, reason: "self_referral" });

        const { error } = await supabaseAdmin
          .from("profiles")
          .update({ referred_by_user_id: referrer.id })
          .eq("id", ctx.userId)
          .is("referred_by_user_id", null);
        if (error) throw new Error(error.message);

        await grantRewardAction({
          userId: referrer.id,
          action: "invite_registration",
          resourceType: "user",
          resourceId: ctx.userId,
        });

        return apiData({ linked: true });
      }),
    },
  },
});
