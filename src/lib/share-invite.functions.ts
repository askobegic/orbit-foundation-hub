// Extends the existing Share & Invite / referral functionality
// (ShareAndInvite.tsx, referral.ts, rewards.functions.ts's linkReferral)
// with per-application, admin-configurable templates. See
// PROJECT_KNOWLEDGE.md -> Share Profile / Invite a Friend.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";

export type ShareInviteConfig = {
  shareTitle: string | null;
  shareDescription: string | null;
  shareUrl: string | null;
  inviteTemplate: string | null;
};

const configSchema = z.object({ appId: z.string().uuid() });

// Public: whatever the admin has configured for this application, or null
// per field -- no server-side hardcoded English fallback. The caller
// (ShareAndInvite.tsx) fills any gap with a locale-aware default via i18n.
export const getShareInviteConfig = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => configSchema.parse(raw))
  .handler(async ({ data }): Promise<ShareInviteConfig> => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: row } = await supabase
      .from("share_invite_templates")
      .select("*")
      .eq("app_id", data.appId)
      .maybeSingle();
    return {
      shareTitle: row?.share_title ?? null,
      shareDescription: row?.share_description ?? null,
      shareUrl: row?.share_url ?? null,
      inviteTemplate: row?.invite_template ?? null,
    };
  });

const upsertSchema = z.object({
  appId: z.string().uuid(),
  shareTitle: z.string().trim().max(200).nullable(),
  shareDescription: z.string().trim().max(500).nullable(),
  shareUrl: z.string().trim().max(500).nullable(),
  inviteTemplate: z.string().trim().max(1000).nullable(),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertShareInviteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: previous } = await supabaseAdmin
      .from("share_invite_templates")
      .select("*")
      .eq("app_id", data.appId)
      .maybeSingle();

    const { data: row, error } = await supabaseAdmin
      .from("share_invite_templates")
      .upsert(
        {
          app_id: data.appId,
          share_title: data.shareTitle,
          share_description: data.shareDescription,
          share_url: data.shareUrl,
          invite_template: data.inviteTemplate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "app_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: previous ? "share_invite_template.update" : "share_invite_template.create",
      entityType: "share_invite_template",
      entityId: data.appId,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });
