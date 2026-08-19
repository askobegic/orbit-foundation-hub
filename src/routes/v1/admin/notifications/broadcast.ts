// API_CONTRACT.md §17 -- POST /v1/admin/notifications/broadcast. Mirrors
// adminSendNotification (admin.functions.ts) exactly -- both now route
// through notify.server.ts's resolveAudience/sendNotification/
// sendBulkNotifications rather than maintaining a second hand-duplicated
// implementation. category/targetPath were documented in this contract
// since Priority 15 Phase D but missing from this route's body schema
// until the CORE Notification & User Engagement System pass.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { resolveAudience, sendBulkNotifications, sendNotification } from "@/lib/notify.server";
import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  target: z.enum(["all", "premium", "user"]),
  userId: z.string().uuid().optional(),
  appId: z.string().uuid().nullable().optional(),
  type: z.enum(["info", "success", "warning", "error"]).default("info"),
  category: z
    .enum(["information", "reward", "premium", "offer", "warning", "system"])
    .nullable()
    .optional(),
  targetPath: z
    .string()
    .regex(/^\/dashboard\/[a-zA-Z0-9/_-]*$/)
    .nullable()
    .optional(),
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

        const content = {
          titleBs: data.title.bs,
          titleEn: data.title.en,
          titleDe: data.title.de,
          messageBs: data.message.bs,
          messageEn: data.message.en,
          messageDe: data.message.de,
        };

        let sent: number;
        if (data.target === "user") {
          const result = await sendNotification({
            userId: data.userId!,
            appId: data.appId ?? null,
            type: data.type,
            category: data.category ?? "information",
            targetPath: data.targetPath ?? null,
            content,
          });
          sent = result.created ? 1 : 0;
        } else {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const userIds = await resolveAudience(
            supabaseAdmin,
            data.target === "premium" ? "premium" : "all",
          );
          const result = await sendBulkNotifications({
            userIds,
            appId: data.appId ?? null,
            type: data.type,
            category: data.category ?? "information",
            targetPath: data.targetPath ?? null,
            content,
          });
          sent = result.sent;
        }

        await writeAuditLog({
          userId: admin.userId,
          action: "notification.broadcast",
          entityType: "notification",
          newData: { target: data.target, count: sent },
        });

        return apiData({ sent });
      }),
    },
  },
});
