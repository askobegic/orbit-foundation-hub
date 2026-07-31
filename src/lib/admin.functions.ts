import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertAdmin,
  writeAuditLog,
  addMonthsIso,
  deleteUserAccountCascade,
} from "@/lib/admin.server";
import { isSubscriptionActiveNow } from "@/lib/subscription";

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
      .upsert(data)
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
      .upsert(
        {
          user_id: data.user_id,
          app_id: data.app_id,
          plan_id: data.plan_id ?? null,
          status: "active",
          started_at: new Date().toISOString(),
          expires_at,
          amount_paid: 0,
          currency: "EUR",
        },
        { onConflict: "user_id,app_id" },
      )
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Global Premium Visibility & Contact System: Premium status is derived
    // solely from hasAnyActivePremium() (live, from `subscriptions`) --
    // profiles.user_type is no longer written here. The previous write left
    // a stale, drift-prone duplicate: adminRevokePremium never reset it, so
    // a revoked user's admin-panel badge stayed stuck on "premium" forever.

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
    });

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
      .update({ status: "cancelled", expires_at: new Date().toISOString() })
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

const listUsersSchema = z.object({
  search: z.string().optional().default(""),
  // Global Premium Visibility & Contact System: premium/standard is no
  // longer a profiles.user_type value -- it's derived live from
  // subscriptions, the same predicate hasAnyActivePremium() uses.
  premiumFilter: z.enum(["premium", "standard"]).optional(),
  is_verified: z.boolean().optional(),
  is_active: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listUsersSchema.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve the full set of currently-Premium user ids up front -- same
    // "active" predicate as has_any_active_premium() -- only when the
    // caller actually asked to filter or needs it applied before pagination.
    let premiumUserIds: string[] | null = null;
    if (data.premiumFilter) {
      const { data: activeSubs, error: subsError } = await supabaseAdmin
        .from("subscriptions")
        .select("user_id")
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString());
      if (subsError) throw new Error(subsError.message);
      premiumUserIds = [
        ...new Set((activeSubs ?? []).map((s) => s.user_id).filter((id): id is string => !!id)),
      ];
    }

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = supabaseAdmin
      .from("profiles")
      .select(
        "id, email, first_name, last_name, username, city, country, is_verified, is_active, created_at, updated_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);
    if (data.search) {
      const s = `%${data.search}%`;
      q = q.or(
        `email.ilike.${s},username.ilike.${s},first_name.ilike.${s},last_name.ilike.${s}`,
      );
    }
    if (data.premiumFilter === "premium") {
      q = q.in("id", premiumUserIds!.length > 0 ? premiumUserIds! : ["00000000-0000-0000-0000-000000000000"]);
    } else if (data.premiumFilter === "standard") {
      if (premiumUserIds!.length > 0) q = q.not("id", "in", `(${premiumUserIds!.join(",")})`);
    }
    if (data.is_verified !== undefined) q = q.eq("is_verified", data.is_verified);
    if (data.is_active !== undefined) q = q.eq("is_active", data.is_active);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);

    // Per-row Premium badge for the page actually being displayed -- a
    // second, cheap set-membership check, not a re-query, when the filter
    // above already resolved the full set.
    const pageIds = (rows ?? []).map((r) => r.id);
    let premiumOnPage: Set<string>;
    if (premiumUserIds) {
      premiumOnPage = new Set(premiumUserIds);
    } else {
      const { data: activeSubs, error: subsError } = await supabaseAdmin
        .from("subscriptions")
        .select("user_id")
        .in("user_id", pageIds.length > 0 ? pageIds : ["00000000-0000-0000-0000-000000000000"])
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString());
      if (subsError) throw new Error(subsError.message);
      premiumOnPage = new Set(
        (activeSubs ?? []).map((s) => s.user_id).filter((id): id is string => !!id),
      );
    }
    const rowsWithPremium = (rows ?? []).map((r) => ({
      ...r,
      is_premium: premiumOnPage.has(r.id),
    }));

    return { rows: rowsWithPremium, total: count ?? 0, page: data.page, pageSize: data.pageSize };
  });

// ---------- User actions: edit, suspend/reactivate, delete ----------
// Deliberately excludes first_name/last_name/avatar_url -- those are under
// Identity Lock (see PROJECT_KNOWLEDGE.md -> Profiles); editing them is a
// separate, not-yet-built administrator identity-review workflow, not part
// of general user-management completion.

const userUpdateSchema = z.object({
  user_id: z.string().uuid(),
  city: z.string().trim().min(1).nullable().optional(),
  country: z.string().trim().min(1).nullable().optional(),
  bio: z.string().nullable().optional(),
  username: z.string().trim().min(1).nullable().optional(),
  email: z.string().email().nullable().optional(),
});

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => userUpdateSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { user_id, ...patch } = data;
    const { data: row, error } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", user_id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "user.update",
      entityType: "profile",
      entityId: user_id,
      newData: patch,
    });
    return row;
  });

export const adminSetUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ user_id: z.string().uuid(), is_active: z.boolean() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId && !data.is_active) {
      throw new Error("You cannot suspend your own account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("profiles")
      .update({ is_active: data.is_active })
      .eq("id", data.user_id)
      .select("id, is_active")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: data.is_active ? "user.reactivate" : "user.suspend",
      entityType: "profile",
      entityId: data.user_id,
      newData: { is_active: data.is_active },
    });
    return row;
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ user_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) {
      throw new Error("Use account settings to delete your own account.");
    }
    await deleteUserAccountCascade({
      targetUserId: data.user_id,
      actorUserId: context.userId,
      action: "user.delete",
    });
    return { ok: true };
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
        .eq("status", "success")
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
        .select("user_id, status, expires_at")
        .eq("status", "active");
      userIds = Array.from(
        new Set(
          ((subs ?? []) as { user_id: string; status: "active"; expires_at: string }[])
            .filter(isSubscriptionActiveNow)
            .map((r) => r.user_id),
        ),
      );
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
    const { error } = await supabaseAdmin.from("notifications").insert(rows);
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
      .select("user_id, status, expires_at")
      .eq("status", "active");
    const ids = Array.from(
      new Set(
        ((subs ?? []) as { user_id: string; status: "active"; expires_at: string }[])
          .filter(isSubscriptionActiveNow)
          .map((r) => r.user_id),
      ),
    );
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
      .update({ is_verified: data.verified })
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

// ---------- App creation ----------
// New applications are registered here and nowhere else. Nothing about
// fulfillment, auth, profiles, notifications, or permissions references a
// specific application anywhere in the Core -- every one of those systems
// already operates generically on whatever app_id exists, so a new row
// here is immediately a fully-functional application with no further
// wiring required.

// Shared by appCreateSchema and appSettingsSchema below -- the slug format
// rule is defined once here, not duplicated per schema.
const appSlugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only");

const appCreateSchema = z.object({
  name: z.string().min(1),
  slug: appSlugSchema,
  domain: z.string().min(1).nullable().optional(),
  primary_color: z.string().min(1).optional(),
  secondary_color: z.string().min(1).optional(),
  google_client_id: z.string().min(1).nullable().optional(),
});

export const adminCreateApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => appCreateSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // New applications start disabled -- the admin explicitly enables them
    // (via the existing is_enabled toggle) once branding/plans are set up,
    // instead of a half-configured app appearing live immediately.
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .insert({ ...data, is_enabled: false })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "application.create",
      entityType: "application",
      entityId: (row as { id: string }).id,
      newData: row,
    });
    return row;
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
      .update({ is_enabled: data.is_enabled })
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

// ---------- App settings (identity, branding, logo, favicon, descriptions, enabled) ----------
// Extensible by design: every field here is optional except app_id, so
// adding another editable application setting in the future means adding
// one more optional key to this schema and one more <Field>/<DescField>
// in AppSettings (src/routes/admin.applications.tsx) -- not a new
// function, route, or admin UI pattern.

const appSettingsSchema = z.object({
  app_id: z.string().uuid(),
  name: z.string().min(1).optional(),
  slug: appSlugSchema.optional(),
  domain: z.string().min(1).nullable().optional(),
  primary_color: z.string().min(1).optional(),
  secondary_color: z.string().min(1).optional(),
  cover_image_url: z.string().url().nullable().optional(),
  sort_order: z.number().int().optional(),
  logo_url: z.string().url().nullable().optional(),
  favicon_url: z.string().url().nullable().optional(),
  google_client_id: z.string().min(1).nullable().optional(),
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
      .update(patch)
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
