// API_CONTRACT.md §15 -- PUT /v1/admin/applications/{appId}/share-invite.
// Replicates adminUpsertShareInviteTemplate (share-invite.functions.ts)
// since it's a requireSupabaseAuth-middleware server function.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { writeAuditLog } from "@/lib/admin.server";
import { apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  shareTitle: z.string().trim().max(200).nullable().optional(),
  shareDescription: z.string().trim().max(500).nullable().optional(),
  shareUrl: z.string().trim().max(500).nullable().optional(),
  inviteTemplate: z.string().trim().max(1000).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const Route = createFileRoute("/v1/admin/applications/$appId/share-invite")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: previous } = await supabaseAdmin
          .from("share_invite_templates")
          .select("*")
          .eq("app_id", params.appId)
          .maybeSingle();

        const { data: row, error } = await supabaseAdmin
          .from("share_invite_templates")
          .upsert(
            {
              app_id: params.appId,
              share_title:
                data.shareTitle !== undefined ? data.shareTitle : (previous?.share_title ?? null),
              share_description:
                data.shareDescription !== undefined
                  ? data.shareDescription
                  : (previous?.share_description ?? null),
              share_url:
                data.shareUrl !== undefined ? data.shareUrl : (previous?.share_url ?? null),
              invite_template:
                data.inviteTemplate !== undefined
                  ? data.inviteTemplate
                  : (previous?.invite_template ?? null),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "app_id" },
          )
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: previous ? "share_invite_template.update" : "share_invite_template.create",
          entityType: "share_invite_template",
          entityId: params.appId,
          oldData: previous,
          newData: row,
          reason: data.reason ?? null,
        });

        return apiData({
          shareTitle: row.share_title,
          shareDescription: row.share_description,
          shareUrl: row.share_url,
          inviteTemplate: row.invite_template,
        });
      }),
    },
  },
});
