// Universal Pre-Launch / Public Launch Standard for CORE-connected
// applications. See PROJECT_KNOWLEDGE.md -> Applications Registry &
// Capabilities -> Pre-Launch / Public Launch, and the migration comment on
// applications.launch_status / application_pre_launch_content /
// application_test_users for the schema rationale.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import { isSafeProfileUrl } from "@/lib/url";

// ---------- Pre-Launch Front Page content ----------
// One row per application, mirroring share_invite_templates' shape and
// server-function pattern exactly: nullable fields, no server-side
// hardcoded content, publicly readable, admin-only writes.
export type PreLaunchContent = {
  logoUrl: string | null;
  bannerImageUrl: string | null;
  titleBs: string | null;
  titleEn: string | null;
  titleDe: string | null;
  infoTextBs: string | null;
  infoTextEn: string | null;
  infoTextDe: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

const contentSchema = z.object({ appId: z.string().uuid() });

// Public: whatever the admin has configured for this application, or null
// per field. The Pre-Launch Front Page renders whatever is present and
// omits the rest -- no server-side hardcoded branding for any application.
export const getPreLaunchContent = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => contentSchema.parse(raw))
  .handler(async ({ data }): Promise<PreLaunchContent> => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: row } = await supabase
      .from("application_pre_launch_content")
      .select("*")
      .eq("app_id", data.appId)
      .maybeSingle();
    return {
      logoUrl: row?.logo_url ?? null,
      bannerImageUrl: row?.banner_image_url ?? null,
      titleBs: row?.title_bs ?? null,
      titleEn: row?.title_en ?? null,
      titleDe: row?.title_de ?? null,
      infoTextBs: row?.info_text_bs ?? null,
      infoTextEn: row?.info_text_en ?? null,
      infoTextDe: row?.info_text_de ?? null,
      facebookUrl: row?.facebook_url ?? null,
      instagramUrl: row?.instagram_url ?? null,
      tiktokUrl: row?.tiktok_url ?? null,
      youtubeUrl: row?.youtube_url ?? null,
      contactEmail: row?.contact_email ?? null,
      contactPhone: row?.contact_phone ?? null,
    };
  });

const nullableUrl = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .refine((v) => !v || isSafeProfileUrl(v), { message: "Only http/https URLs are allowed" });

const upsertContentSchema = z.object({
  appId: z.string().uuid(),
  logoUrl: nullableUrl,
  bannerImageUrl: nullableUrl,
  titleBs: z.string().trim().max(200).nullable(),
  titleEn: z.string().trim().max(200).nullable(),
  titleDe: z.string().trim().max(200).nullable(),
  infoTextBs: z.string().trim().max(2000).nullable(),
  infoTextEn: z.string().trim().max(2000).nullable(),
  infoTextDe: z.string().trim().max(2000).nullable(),
  facebookUrl: nullableUrl,
  instagramUrl: nullableUrl,
  tiktokUrl: nullableUrl,
  youtubeUrl: nullableUrl,
  contactEmail: z.string().trim().max(200).nullable(),
  contactPhone: z.string().trim().max(50).nullable(),
  reason: z.string().trim().max(500).optional(),
});

export const adminUpsertPreLaunchContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertContentSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: previous } = await supabaseAdmin
      .from("application_pre_launch_content")
      .select("*")
      .eq("app_id", data.appId)
      .maybeSingle();

    const { data: row, error } = await supabaseAdmin
      .from("application_pre_launch_content")
      .upsert(
        {
          app_id: data.appId,
          logo_url: data.logoUrl,
          banner_image_url: data.bannerImageUrl,
          title_bs: data.titleBs,
          title_en: data.titleEn,
          title_de: data.titleDe,
          info_text_bs: data.infoTextBs,
          info_text_en: data.infoTextEn,
          info_text_de: data.infoTextDe,
          facebook_url: data.facebookUrl,
          instagram_url: data.instagramUrl,
          tiktok_url: data.tiktokUrl,
          youtube_url: data.youtubeUrl,
          contact_email: data.contactEmail,
          contact_phone: data.contactPhone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "app_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: previous ? "pre_launch_content.update" : "pre_launch_content.create",
      entityType: "application_pre_launch_content",
      entityId: data.appId,
      oldData: previous,
      newData: row,
      reason: data.reason ?? null,
    });
    return row;
  });

// ---------- Authorized test users ----------
// Mirrors adminSetTrustedAdvertiser / adminListTrustedAdvertisers
// (advertising.functions.ts) exactly -- test access is per-application,
// not global, same as trusted-advertiser status.
const testUserSchema = z.object({
  userId: z.string().uuid(),
  appId: z.string().uuid(),
  authorized: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetTestUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => testUserSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.authorized) {
      const { error } = await supabaseAdmin
        .from("application_test_users")
        .upsert(
          { user_id: data.userId, app_id: data.appId, granted_by: context.userId },
          { onConflict: "user_id,app_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("application_test_users")
        .delete()
        .eq("user_id", data.userId)
        .eq("app_id", data.appId);
      if (error) throw new Error(error.message);
    }

    await writeAuditLog({
      userId: context.userId,
      action: data.authorized ? "application_test_user.grant" : "application_test_user.revoke",
      entityType: "application_test_user",
      entityId: data.userId,
      newData: { appId: data.appId },
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

const listTestUsersSchema = z.object({ appId: z.string().uuid() });

export const adminListTestUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listTestUsersSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("application_test_users")
      .select("*, profiles!application_test_users_user_id_fkey(username, first_name, last_name)")
      .eq("app_id", data.appId)
      .order("granted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// Admin-only: find a user by exact username to grant test access to,
// mirroring the existing username-lookup pattern used by admin user search
// (src/routes/admin.users.tsx) rather than inventing a new lookup shape.
const findUserSchema = z.object({ username: z.string().trim().min(1) });

export const adminFindUserByUsername = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => findUserSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("profiles")
      .select("id, username, first_name, last_name")
      .eq("username", data.username.trim())
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ?? null;
  });
