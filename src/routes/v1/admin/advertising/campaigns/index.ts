// API_CONTRACT.md §14 -- GET /v1/admin/advertising/campaigns?status=pending.
// Moderation queue -- replicates adminListCampaigns (advertising.functions.ts).
import { createFileRoute } from "@tanstack/react-router";

import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/advertising/campaigns/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const url = new URL(request.url);
        const status = url.searchParams.get("status");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let query = supabaseAdmin
          .from("ad_campaigns")
          .select("*, profiles(username, first_name, last_name), applications(name, slug)");
        if (status) query = query.eq("status", status);
        const { data, error } = await query.order("created_at", { ascending: false });
        if (error) throw new Error(error.message);

        return apiData(
          (data ?? []).map((c) => ({
            id: c.id,
            appId: c.app_id,
            appName: c.applications?.name ?? null,
            userId: c.user_id,
            userName:
              [c.profiles?.first_name, c.profiles?.last_name].filter(Boolean).join(" ") ||
              c.profiles?.username,
            placementKey: c.placement_key,
            title: c.title,
            imageUrl: c.image_url,
            linkUrl: c.link_url,
            status: c.status,
            moderationNote: c.moderation_note,
            startsAt: c.starts_at,
            expiresAt: c.expires_at,
            createdAt: c.created_at,
          })),
        );
      }),
    },
  },
});
