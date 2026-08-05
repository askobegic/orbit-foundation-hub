// API_CONTRACT.md §14 -- PUT /v1/admin/applications/{appId}/advertising-settings.
// Per-application override -- either field null clears the override back
// to the global ad_config default (resolveModerationMode/
// resolveEligibilityRule already implement that fallback).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  moderationMode: z.enum(["manual", "auto", "trusted_only"]).nullable(),
  eligibilityRule: z.enum(["anyone", "premium_only", "verified_only", "trusted_only"]).nullable(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/applications/$appId/advertising-settings")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("ad_application_settings")
          .select("*")
          .eq("app_id", params.appId)
          .maybeSingle();

        const { data: row, error } = await supabaseAdmin
          .from("ad_application_settings")
          .upsert(
            {
              app_id: params.appId,
              moderation_mode: data.moderationMode,
              eligibility_rule: data.eligibilityRule,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "app_id" },
          )
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "ad_application_settings.set",
          entityType: "ad_application_settings",
          entityId: params.appId,
          oldData: previous,
          newData: row,
          reason: data.reason ?? null,
        });

        return apiData({
          appId: row.app_id,
          moderationMode: row.moderation_mode,
          eligibilityRule: row.eligibility_rule,
        });
      }),
    },
  },
});
