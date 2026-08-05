// API_CONTRACT.md §17 -- POST /v1/admin/notifications/broadcast. Replicates
// adminSendNotification (admin.functions.ts) since it's a
// requireSupabaseAuth-middleware server function; resolvePremiumStatusBulk
// (premium.server.ts) reused directly so target: "premium" reaches
// Trial-only Premium users too (PROJECT_AUDIT.md -> AD-13's fix).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { resolvePremiumStatusBulk } from "@/lib/premium.server";
import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  target: z.enum(["all", "premium", "user"]),
  userId: z.string().uuid().optional(),
  appId: z.string().uuid().nullable().optional(),
  type: z.enum(["info", "success", "warning", "error"]).default("info"),
  title: z.object({ bs: z.string().min(1), en: z.string().min(1), de: z.string().min(1) }),
  message: z.object({ bs: z.string().min(1), en: z.string().min(1), de: z.string().min(1) }),
});

export const Route = createFileRoute("/v1/admin/notifications/broadcast")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));
        if (data.target === "user" && !data.userId) {
          throw new ApiError("VALIDATION_ERROR", 'userId is required when target is "user".', [
            { field: "userId", issue: "required" },
          ]);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let userIds: string[] = [];
        if (data.target === "user") {
          userIds = [data.userId!];
        } else if (data.target === "premium") {
          userIds = [...(await resolvePremiumStatusBulk(supabaseAdmin)).keys()];
        } else {
          const { data: profs } = await supabaseAdmin.from("profiles").select("id");
          userIds = (profs ?? []).map((r) => r.id);
        }

        if (userIds.length === 0) return apiData({ sent: 0 });

        const rows = userIds.map((uid) => ({
          user_id: uid,
          app_id: data.appId ?? null,
          type: data.type,
          title_bs: data.title.bs,
          title_en: data.title.en,
          title_de: data.title.de,
          message_bs: data.message.bs,
          message_en: data.message.en,
          message_de: data.message.de,
        }));
        const { error } = await supabaseAdmin.from("notifications").insert(rows);
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "notification.broadcast",
          entityType: "notification",
          newData: { target: data.target, count: userIds.length },
        });

        return apiData({ sent: userIds.length });
      }),
    },
  },
});
