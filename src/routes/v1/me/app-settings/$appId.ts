// API_CONTRACT.md §6 -- PATCH /v1/me/app-settings/{appId}.
// {appId} here names *another* application's settings the user controls
// about themselves -- legitimately client-supplied (§3.3's rule is about
// the *calling* application, not the target of an explicit per-app toggle
// the user already owns).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  isVisible: z.boolean().optional(),
  isContactable: z.boolean().optional(),
});

export const Route = createFileRoute("/v1/me/app-settings/$appId")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const patch: Record<string, boolean> = {};
        if (data.isVisible !== undefined) patch.is_visible = data.isVisible;
        if (data.isContactable !== undefined) patch.is_contactable = data.isContactable;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("user_app_settings")
          .upsert(
            { user_id: ctx.userId, app_id: params.appId, ...patch },
            { onConflict: "user_id,app_id" },
          )
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        return apiData({
          appId: row.app_id,
          isVisible: row.is_visible,
          isContactable: row.is_contactable,
        });
      }),
    },
  },
});
