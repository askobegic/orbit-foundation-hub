// API_CONTRACT.md §11 -- PUT /v1/admin/trial-policy.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";
import type { Json } from "@/integrations/supabase/types";

const bodySchema = z.object({
  presetDays: z.array(z.number().int().min(1)).optional(),
  maxDurationDays: z.number().int().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/trial-policy/")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const updates: { key: string; value: Json }[] = [];
        if (data.presetDays) updates.push({ key: "preset_days", value: data.presetDays as Json });
        if (data.maxDurationDays !== undefined) {
          updates.push({ key: "max_duration_days", value: data.maxDurationDays as Json });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        for (const u of updates) {
          const { data: previous } = await supabaseAdmin
            .from("trial_policy")
            .select("value")
            .eq("key", u.key)
            .maybeSingle();
          const { error } = await supabaseAdmin
            .from("trial_policy")
            .upsert({ key: u.key, value: u.value, updated_at: new Date().toISOString() });
          if (error) throw new Error(error.message);
          await writeAuditLog({
            userId: admin.userId,
            action: "trial_policy.set",
            entityType: "trial_policy",
            entityId: u.key,
            oldData: previous?.value ?? null,
            newData: u.value,
            reason: data.reason ?? null,
          });
        }

        return apiData({ ok: true });
      }),
    },
  },
});
