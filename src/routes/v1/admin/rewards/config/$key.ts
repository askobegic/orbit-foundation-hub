// API_CONTRACT.md §13 -- PUT /v1/admin/rewards/config/{key}.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({ value: z.unknown(), reason: z.string().trim().max(500).optional() });

export const Route = createFileRoute("/v1/admin/rewards/config/$key")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("reward_config")
          .select("value")
          .eq("key", params.key)
          .maybeSingle();

        const { error } = await supabaseAdmin.from("reward_config").upsert({
          key: params.key,
          value: data.value as Json,
          updated_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "reward_config.set",
          entityType: "reward_config",
          entityId: params.key,
          oldData: previous?.value ?? null,
          newData: data.value,
          reason: data.reason ?? null,
        });

        return apiData({ key: params.key, value: data.value });
      }),
    },
  },
});
