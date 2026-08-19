import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const notifyNewUserRegistered = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { sendN8nEvent } = await import("@/lib/n8n.server");
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("id, email, first_name, last_name, country, language")
      .eq("id", context.userId)
      .maybeSingle();
    await sendN8nEvent("new_user_registered", {
      user_id: context.userId,
      profile: profile ?? null,
    });
    return { ok: true };
  });

const prefsSchema = z.object({
  language: z.enum(["bs", "en", "de"]).optional(),
  notify_email: z.boolean().optional(),
  notify_in_app: z.boolean().optional(),
  notify_marketing: z.boolean().optional(),
  // CORE Notification & User Engagement System: per-category email
  // opt-out, narrower than notify_email above (which stays the
  // all-or-nothing switch).
  email_disabled_categories: z.array(z.string()).optional(),
});

export const updateUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => prefsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update(data)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("is_read", false);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
