import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog, addMonthsIso } from "@/lib/admin.server";

export type VerificationRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
  city: string | null;
  country: string | null;
  is_verified: boolean | null;
  created_at: string | null;
};

// ---------- Plans ----------

const planInputSchema = z.object({
  id: z.string().uuid().optional(),
  app_id: z.string().uuid(),
  name: z.string().min(1),
  duration_months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
  price: z.number().nonnegative(),
  currency: z.string().default("EUR"),
  stripe_payment_link: z.string().url().nullable().optional(),
  paypal_payment_link: z.string().url().nullable().optional(),
  features_bs: z.array(z.string()).default([]),
  features_en: z.array(z.string()).default([]),
  features_de: z.array(z.string()).default([]),
  is_active: z.boolean().default(true),
});

export const adminUpsertPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => planInputSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("subscription_plans")
      .upsert(data as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "plan.update" : "plan.create",
      entityType: "subscription_plan",
      entityId: (row as { id: string }).id,
      newData: row,
    });
    return row;
  });

export const adminDeletePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("subscription_plans").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "plan.delete",
      entityType: "subscription_plan",
      entityId: data.id,
    });
    return { ok: true };
  });

// ---------- Grant / revoke premium ----------

const grantSchema = z.object({
  user_id: z.string().uuid(),
  app_id: z.string().uuid(),
  plan_id: z.string().uuid().optional(),
  duration_months: z.number().int().min(1).max(60).default(12),
  reason: z.string().optional(),
});

export const adminGrantPremium = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => grantSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const expires_at = addMonthsIso(data.duration_months);
    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        user_id: data.user_id,
        app_id: data.app_id,
        plan_id: data.plan_id ?? null,
        status: "active",
        started_at: new Date().toISOString(),
        expires_at,
        amount_paid: 0,
        currency: "EUR",
      } as never)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin
      .from("profiles")
      .update({ user_type: "premium" } as never)
      .eq("id", data.user_id);

    await writeAuditLog({
      userId: context.userId,
      action: "premium.grant",
      entityType: "subscription",
      entityId: (sub as { id: string }).id,
      newData: { ...data, reason: data.reason ?? null },
    });

    await supabaseAdmin.from("notifications").insert({
      user_id: data.user_id,
      title_bs: "Premium aktiviran",
      title_en: "Premium activated",
      title_de: "Premium aktiviert",
      message_bs: "Vaš premium pristup je aktiviran.",
      message_en: "Your premium access is now active.",
      message_de: "Ihr Premium-Zugang ist jetzt aktiv.",
      type: "success",
      app_id: data.app_id,
    } as never);

    const { sendN8nEvent } = await import("@/lib/n8n.server");
    await sendN8nEvent("premium_activated", {
      provider: "admin_grant",
      user_id: data.user_id,
      app_id: data.app_id,
      subscription_id: (sub as { id: string }).id,
      duration_months: data.duration_months,
    });

    return sub;
  });

export const adminRevokePremium = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ subscription_id: z.string().uuid(), reason: z.string().optional() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "cancelled", expires_at: new Date().toISOString() } as never)
      .eq("id", data.subscription_id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "premium.revoke",
      entityType: "subscription",
      entityId: data.subscription_id,
      newData: { reason: data.reason ?? null },
    });
    return sub;
  });

// ---------- Admin lists ----------

export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ search: z.string().optional().default("") }).parse(raw ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("profiles")
      .select("id, email, first_name, last_name, username, user_type, city, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.search) {
      const s = `%${data.search}%`;
      q = q.or(
        `email.ilike.${s},username.ilike.${s},first_name.ilike.${s},last_name.ilike.${s}`,
      );
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminListAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- Is admin (client convenience) ----------

export const getMyIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    console.log("[getMyIsAdmin]", { userId: context.userId, role: data?.role ?? null });
    const role = (data?.role ?? null) as string | null;
    return { isAdmin: role === "admin", role };
  });

// ---------- Overview stats ----------

export const adminOverviewStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [users, active, payments, newUsers] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("subscriptions")
        .select("id, started_at, expires_at, amount_paid")
        .eq("status", "active")
        .gt("amount_paid", 0)
        .gt("expires_at", new Date().toISOString())
        .lte("started_at", new Date().toISOString()),
      supabaseAdmin
        .from("payments")
        .select("amount")
        .eq("status", "completed")
        .gte("created_at", startOfMonth),
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo),
    ]);

    const revenue = ((payments.data ?? []) as { amount: number | string }[]).reduce(
      (s, r) => s + Number(r.amount ?? 0),
      0,
    );

    const MIN_MS = 28 * 24 * 60 * 60 * 1000;
    const activePremiumCount = ((active.data ?? []) as { started_at: string; expires_at: string }[])
      .filter((r) => new Date(r.expires_at).getTime() - new Date(r.started_at).getTime() >= MIN_MS)
      .length;

    return {
      totalUsers: users.count ?? 0,
      activePremium: activePremiumCount,
      revenueThisMonth: revenue,
      newUsersThisWeek: newUsers.count ?? 0,
    };
  });

// ---------- Notifications ----------

const notifySchema = z.object({
  target: z.enum(["all", "premium", "user"]),
  user_id: z.string().uuid().optional(),
  app_id: z.string().uuid().nullable().optional(),
  type: z.enum(["info", "success", "warning", "error"]).default("info"),
  title_bs: z.string().min(1),
  title_en: z.string().min(1),
  title_de: z.string().min(1),
  message_bs: z.string().min(1),
  message_en: z.string().min(1),
  message_de: z.string().min(1),
});

export const adminSendNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => notifySchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let userIds: string[] = [];
    if (data.target === "user") {
      if (!data.user_id) throw new Error("user_id required");
      userIds = [data.user_id];
    } else if (data.target === "premium") {
      const { data: subs } = await supabaseAdmin
        .from("subscriptions")
        .select("user_id")
        .eq("status", "active");
      userIds = Array.from(new Set(((subs ?? []) as { user_id: string }[]).map((r) => r.user_id)));
    } else {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id");
      userIds = ((profs ?? []) as { id: string }[]).map((r) => r.id);
    }

    if (userIds.length === 0) return { sent: 0 };

    const rows = userIds.map((uid) => ({
      user_id: uid,
      app_id: data.app_id ?? null,
      type: data.type,
      title_bs: data.title_bs,
      title_en: data.title_en,
      title_de: data.title_de,
      message_bs: data.message_bs,
      message_en: data.message_en,
      message_de: data.message_de,
    }));
    const { error } = await supabaseAdmin.from("notifications").insert(rows as never);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "notification.broadcast",
      entityType: "notification",
      newData: { target: data.target, count: userIds.length },
    });
    return { sent: userIds.length };
  });

// ---------- Payments list ----------

export const adminListPayments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("payments")
      .select("id, user_id, app_id, amount, currency, status, payment_method, invoice_url, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- Verification ----------

export const adminListVerificationRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Candidates: premium (active subscription) users not yet verified
    const { data: subs } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id")
      .eq("status", "active");
    const ids = Array.from(new Set(((subs ?? []) as { user_id: string }[]).map((r) => r.user_id)));
    if (ids.length === 0) return [] as VerificationRow[];
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, first_name, last_name, username, avatar_url, city, country, is_verified, created_at")
      .in("id", ids)
      .order("is_verified", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as VerificationRow[];
  });

export const adminSetVerified = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ user_id: z.string().uuid(), verified: z.boolean() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_verified: data.verified } as never)
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: data.verified ? "verification.approve" : "verification.reject",
      entityType: "profile",
      entityId: data.user_id,
      newData: { is_verified: data.verified },
    });
    return { ok: true };
  });

// ---------- App enable/disable ----------

export const adminSetAppEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ app_id: z.string().uuid(), is_enabled: z.boolean() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .update({ is_enabled: data.is_enabled } as never)
      .eq("id", data.app_id)
      .select("id, is_enabled")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: data.is_enabled ? "app_enabled" : "app_disabled",
      entityType: "application",
      entityId: data.app_id,
      newData: { is_enabled: data.is_enabled },
    });
    return row;
  });

// ---------- App settings (logo, favicon, descriptions, enabled) ----------

const appSettingsSchema = z.object({
  app_id: z.string().uuid(),
  logo_url: z.string().url().nullable().optional(),
  favicon_url: z.string().url().nullable().optional(),
  short_description_bs: z.string().max(160).nullable().optional(),
  short_description_en: z.string().max(160).nullable().optional(),
  short_description_de: z.string().max(160).nullable().optional(),
  is_enabled: z.boolean(),
});

export const adminUpdateAppSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => appSettingsSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { app_id, ...patch } = data;
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .update(patch as never)
      .eq("id", app_id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "app.settings_update",
      entityType: "application",
      entityId: app_id,
      newData: patch,
    });
    return row;
  });