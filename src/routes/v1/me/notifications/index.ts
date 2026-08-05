// API_CONTRACT.md §17 -- GET /v1/me/notifications. title/message resolved
// server-side to the caller's own locale via the shared §4.9 resolver --
// never the raw _bs/_en/_de triplet.
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";
import { pickLocalized, resolveLocale } from "@/lib/v1/locale.server";

export const Route = createFileRoute("/v1/me/notifications/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const url = new URL(request.url);
        const isReadFilter = url.searchParams.get("isRead");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let query = supabaseAdmin.from("notifications").select("*").eq("user_id", ctx.userId);
        if (isReadFilter !== null) query = query.eq("is_read", isReadFilter === "true");
        const { data, error } = await query.order("created_at", { ascending: false });
        if (error) throw new Error(error.message);

        const locale = await resolveLocale({
          request,
          supabaseAdmin,
          userId: ctx.userId,
          appId: ctx.appId,
        });

        return apiData(
          (data ?? []).map((n) => ({
            id: n.id,
            type: n.type,
            title: pickLocalized(n, "title", locale) ?? pickLocalized(n, "title", "en"),
            message: pickLocalized(n, "message", locale) ?? pickLocalized(n, "message", "en"),
            isRead: n.is_read,
            createdAt: n.created_at,
          })),
        );
      }),
    },
  },
});
