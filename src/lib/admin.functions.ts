import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog, addMonthsIso } from "@/lib/admin.server";

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
    return { isAdmin: role === "admin" || role === "super_admin", role };
  });