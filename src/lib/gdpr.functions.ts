import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const exportUserData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [profile, premium, subs, payments, notifications, appSettings] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("premium_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("subscriptions").select("*").eq("user_id", userId),
      supabase.from("payments").select("*").eq("user_id", userId),
      supabase.from("notifications").select("*").eq("user_id", userId),
      supabase.from("user_app_settings").select("*").eq("user_id", userId),
    ]);
    return {
      exported_at: new Date().toISOString(),
      user_id: userId,
      profile: profile.data ?? null,
      premium_profile: premium.data ?? null,
      subscriptions: subs.data ?? [],
      payments: payments.data ?? [],
      notifications: notifications.data ?? [],
      user_app_settings: appSettings.data ?? [],
    };
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, supabase } = context;

    const { data: profile } = await supabase
      .from("profiles")
      .select("email, username")
      .eq("id", userId)
      .maybeSingle();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Audit BEFORE deletion so it survives cascades.
    await supabaseAdmin.from("audit_logs").insert({
      user_id: userId,
      action: "account_deleted",
      entity_type: "user",
      entity_id: userId,
      old_data: { email: profile?.email ?? null, username: profile?.username ?? null },
    } as never);

    // Cascade-delete related rows (RLS bypassed via admin).
    const userIdTables = [
      "user_app_settings",
      "notifications",
      "payments",
      "subscriptions",
      "premium_profiles",
      "user_roles",
    ] as const;
    const failedTables: string[] = [];
    for (const t of userIdTables) {
      const { error } = await supabaseAdmin.from(t).delete().eq("user_id", userId);
      if (error) {
        console.error("deleteMyAccount: delete failed", t, error);
        failedTables.push(t);
      }
    }
    if (failedTables.length > 0) {
      throw new Error(`Account deletion incomplete, failed to delete from: ${failedTables.join(", ")}`);
    }

    // Best-effort avatar cleanup -- doesn't block account deletion if it fails.
    const { data: avatarFiles } = await supabaseAdmin.storage.from("avatars").list(userId);
    if (avatarFiles && avatarFiles.length > 0) {
      const { error: storageErr } = await supabaseAdmin.storage
        .from("avatars")
        .remove(avatarFiles.map((f) => `${userId}/${f.name}`));
      if (storageErr) console.error("deleteMyAccount: avatar cleanup failed", storageErr);
    }

    // profiles is keyed by id (matches auth.users.id)
    const { error: profileDeleteErr } = await supabaseAdmin.from("profiles").delete().eq("id", userId);
    if (profileDeleteErr) throw new Error(profileDeleteErr.message);

    // Finally remove the auth user.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });