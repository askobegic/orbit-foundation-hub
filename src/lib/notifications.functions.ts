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
});

export const updateUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => prefsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update(data as never)
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ is_read: true } as never)
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
      .update({ is_read: true } as never)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const supportSchema = z.object({
  subject: z.string().min(2).max(200),
  message: z.string().min(5).max(5000),
  category: z.string().max(60).optional(),
});

export const sendSupportRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => supportSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { sendN8nEvent } = await import("@/lib/n8n.server");
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("id, email, first_name, last_name, language")
      .eq("id", context.userId)
      .maybeSingle();
    await sendN8nEvent("support_request", {
      user_id: context.userId,
      profile: profile ?? null,
      subject: data.subject,
      message: data.message,
      category: data.category ?? null,
    });
    return { ok: true };
  });