// API_CONTRACT.md §14 -- PUT /v1/admin/advertising/config. Any subset of
// { moderationMode, eligibilityRule, draftExpiryHours } -- same ad_config
// table/keys as adminSetAdConfig/adminSetAdDraftExpiryHours
// (advertising.functions.ts), unified into the one PUT the contract
// documents rather than three separate calls.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import type { supabaseAdmin as SupabaseAdminClient } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  moderationMode: z.enum(["manual", "auto", "trusted_only"]).optional(),
  eligibilityRule: z.enum(["anyone", "premium_only", "verified_only", "trusted_only"]).optional(),
  draftExpiryHours: z.number().int().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

async function setConfigKey(
  supabaseAdmin: typeof SupabaseAdminClient,
  adminUserId: string,
  key: string,
  value: Json,
  reason: string | null,
) {
  const { data: previous } = await supabaseAdmin
    .from("ad_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const { error } = await supabaseAdmin
    .from("ad_config")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);

  await writeAuditLog({
    userId: adminUserId,
    action: "ad_config.set",
    entityType: "ad_config",
    entityId: key,
    oldData: previous?.value ?? null,
    newData: value,
    reason,
  });
}

export const Route = createFileRoute("/v1/admin/advertising/config/")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const reason = data.reason ?? null;
        if (data.moderationMode !== undefined) {
          await setConfigKey(
            supabaseAdmin,
            admin.userId,
            "moderation_mode",
            data.moderationMode,
            reason,
          );
        }
        if (data.eligibilityRule !== undefined) {
          await setConfigKey(
            supabaseAdmin,
            admin.userId,
            "eligibility_rule",
            data.eligibilityRule,
            reason,
          );
        }
        if (data.draftExpiryHours !== undefined) {
          await setConfigKey(
            supabaseAdmin,
            admin.userId,
            "draft_expiry_hours",
            data.draftExpiryHours,
            reason,
          );
        }

        const { data: rows, error } = await supabaseAdmin.from("ad_config").select("*");
        if (error) throw new Error(error.message);
        const map = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
        return apiData({
          moderationMode: map.moderation_mode ?? "manual",
          eligibilityRule: map.eligibility_rule ?? "anyone",
          draftExpiryHours: map.draft_expiry_hours ?? 48,
        });
      }),
    },
  },
});
