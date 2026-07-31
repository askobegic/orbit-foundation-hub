import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { deleteUserAccountCascade } from "@/lib/admin.server";

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
    await deleteUserAccountCascade({
      targetUserId: context.userId,
      actorUserId: context.userId,
      action: "account_deleted",
    });
    return { ok: true };
  });
