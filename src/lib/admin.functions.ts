import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertAdmin,
  writeAuditLog,
  addMonthsIso,
  deleteUserAccountCascade,
  BRANDING_ALLOWED_TYPES,
  brandingMaxSize,
  writeBrandingAsset,
} from "@/lib/admin.server";
import { resolvePremiumStatus, resolvePremiumStatusBulk } from "@/lib/premium.server";

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

// ---------- Products (Priority 8.11 -- was "Plans"; subscription_plans is
// unchanged at the database level, see the migration comment for why) ----------

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
  // Priority 8.11: admin-facing classification only -- does not change
  // checkout/entitlement logic. See ProductType (src/types/database.ts).
  product_type: z.enum(["subscription", "promotion", "one_time"]).default("subscription"),
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

// CORE admin panel's own branding-upload entry point (admin.applications.tsx)
// -- shares BRANDING_ALLOWED_TYPES/brandingMaxSize/writeBrandingAsset with
// the equivalent /v1/admin/media/branding endpoint (admin.server.ts) so the
// two entry points can never drift out of sync, rather than the browser
// client writing to Storage directly (security-sweep Finding 1: bypassed
// server-side admin authorization/validation/audit logging).
const brandingUploadPurposes = ["logo", "favicon", "cover"] as const;

export const adminUploadBrandingAsset = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => data)
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const file = data.get("file");
    const purposeRaw = data.get("purpose");
    const appId = data.get("appId");

    if (!(file instanceof File)) throw new Error("file is required");
    if (
      typeof purposeRaw !== "string" ||
      !brandingUploadPurposes.includes(purposeRaw as (typeof brandingUploadPurposes)[number])
    ) {
      throw new Error("purpose must be logo, favicon, or cover");
    }
    const purpose = purposeRaw as (typeof brandingUploadPurposes)[number];
    if (typeof appId !== "string" || !appId) throw new Error("appId is required");
    if (!BRANDING_ALLOWED_TYPES[file.type]) throw new Error("Unsupported file type.");
    if (file.size > brandingMaxSize(purpose)) throw new Error("File is too large.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: app } = await supabaseAdmin
      .from("applications")
      .select("slug")
      .eq("id", appId)
      .maybeSingle();
    if (!app) throw new Error("Application not found.");

    const result = await writeBrandingAsset({ appSlug: app.slug, purpose, file });

    await writeAuditLog({
      userId: context.userId,
      action: "application.branding_uploaded",
      entityType: "application",
      entityId: appId,
      newData: { purpose, url: result.url },
    });

    return result;
  });

// Priority 8.7 (R-4): was a hard `DELETE`, the only one found across CORE
// during the Priority 8.6 audit -- inconsistent with the soft-lifecycle
// convention every other registry table follows, and redundant besides:
// `is_active` already exists on this table for exactly this purpose (the
// admin UI's own "Active" checkbox already toggles it). Archiving here
// just means "switch it off," never a delete -- a plan referenced by any
// past or present subscription is never at risk of disappearing.
export const adminArchivePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("subscription_plans")
      .update({ is_active: false })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "plan.archive",
      entityType: "subscription_plan",
      entityId: data.id,
      newData: { is_active: false },
    });
    return row;
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

    // Resolve the full set of currently-Premium user ids up front -- via
    // the one shared Premium Status Resolver (Priority 8.7, R-1/R-3), so a
    // user who is Premium only through an active Promotional Trial is
    // filtered/badged identically to one with a paid subscription --
    // only when the caller actually asked to filter or needs it applied
    // before pagination.
    let premiumUserIds: string[] | null = null;
    if (data.premiumFilter) {
      premiumUserIds = [...(await resolvePremiumStatusBulk(supabaseAdmin)).keys()];
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
      premiumOnPage = new Set((await resolvePremiumStatusBulk(supabaseAdmin, pageIds)).keys());
    }
    const rowsWithPremium = (rows ?? []).map((r) => ({
      ...r,
      is_premium: premiumOnPage.has(r.id),
    }));

    return { rows: rowsWithPremium, total: count ?? 0, page: data.page, pageSize: data.pageSize };
  });

// Priority 16 Phase D1: resolved Premium status (active/source/expiry) for
// the Admin User 360 modal -- calls the one existing shared resolver
// (src/lib/premium.server.ts, Priority 8.7 R-1/R-3) instead of a second
// "is this user Premium" calculation. Distinguishes paid subscription vs
// Promotional Trial vs Entitlement (admin/reward-granted) by construction,
// since that's exactly what the resolver already returns.
export const adminGetUserPremiumStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ user_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return resolvePremiumStatus(supabaseAdmin, data.user_id);
  });

// Priority 16 Phase D1: per-user application memberships for the Admin
// User 360 modal. user_app_settings is already the CORE-level identity <->
// application relationship (populated during onboarding, Priority 6) --
// this reads it, it doesn't introduce a new one. Deliberately returns only
// identity-level fields (name/slug/domain, joined_at, visibility/
// contactability) -- never application-specific business data, which stays
// out of CORE per the architecture boundary.
export const adminListUserApplications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ user_id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("user_app_settings")
      .select("app_id, is_visible, is_contactable, joined_at, applications(name, slug, domain)")
      .eq("user_id", data.user_id)
      .order("joined_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- User actions: edit, suspend/reactivate, delete ----------
// Deliberately excludes first_name/last_name/avatar_url -- those are under
// Identity Lock (see PROJECT_KNOWLEDGE.md -> Profiles); editing them is a
// separate, not-yet-built administrator identity-review workflow, not part
// of general user-management completion. Also excludes email (Priority
// 8.7, R-7): the authentication identity is the single source of truth
// for it, resynced automatically by AuthContext.tsx on every session load
// -- an admin override here would just be silently reverted the next time
// the user signs in, so it's not offered as an editable field at all.
const userUpdateSchema = z.object({
  user_id: z.string().uuid(),
  city: z.string().trim().min(1).nullable().optional(),
  country: z.string().trim().min(1).nullable().optional(),
  bio: z.string().nullable().optional(),
  username: z.string().trim().min(1).nullable().optional(),
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

// Priority 16 Phase D2: optional server-side targetUserId filter, for the
// Admin User 360 modal's Audit History tab -- the caller never fetches the
// unfiltered log and filters client-side. audit_logs.user_id is the
// ACTOR (the admin who performed the action), not the target, and
// entity_id is only the target for profile-scoped actions (user.update/
// suspend/verify) -- every other action (premium.grant, entitlement.*,
// reward_ledger.manual_adjustment) records the target inside
// new_data.targetUserId instead. Filtering ORs across both, matching
// how writeAuditLog() actually records each action today, rather than
// requiring a schema change to normalize it into one column.
const auditLogsSchema = z.object({
  targetUserId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const adminListAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => auditLogsSchema.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.targetUserId) {
      q = q.or(`entity_id.eq.${data.targetUserId},new_data->>targetUserId.eq.${data.targetUserId}`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
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

    // Priority 8.7 (R-1): "Active Premium" is resolved through the same
    // shared Premium Status Resolver every other admin surface now uses --
    // previously this counted only paying subscriptions lasting >= 28 days
    // (an ad hoc heuristic that predates Promotional Trials existing as
    // their own table, and never counted a Trial-only Premium user at
    // all). This now matches hasAnyActivePremium()'s own canonical
    // definition exactly: a paid subscription, an active Promotional
    // Trial, or both.
    const [users, premiumStatuses, payments, newUsers] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      resolvePremiumStatusBulk(supabaseAdmin),
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

    return {
      totalUsers: users.count ?? 0,
      activePremium: premiumStatuses.size,
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
  // Priority 15 Phase D: a richer, admin-facing classification, kept
  // separate from `type` (UI severity) above so existing notification
  // semantics never change -- see PROJECT_KNOWLEDGE.md -> Admin -> User
  // Communication.
  category: z.enum(["information", "reward", "premium", "offer", "warning", "system"]).nullable().optional(),
  // Deep link (PROJECT_AUDIT.md -> MSG-3). Internal dashboard paths only
  // -- validated again here even though the DB CHECK constraint is the
  // real enforcement boundary, so a bad value fails with a clear message
  // instead of a raw constraint-violation error.
  target_path: z
    .string()
    .regex(/^\/dashboard\/[a-zA-Z0-9/_-]*$/)
    .nullable()
    .optional(),
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
      // Priority 8.7 (R-1): via the shared resolver, so a Trial-only
      // Premium user is reachable by a "Premium users" broadcast too.
      userIds = [...(await resolvePremiumStatusBulk(supabaseAdmin)).keys()];
    } else {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id");
      userIds = ((profs ?? []) as { id: string }[]).map((r) => r.id);
    }

    if (userIds.length === 0) return { sent: 0 };

    const rows = userIds.map((uid) => ({
      user_id: uid,
      app_id: data.app_id ?? null,
      type: data.type,
      category: data.category ?? null,
      target_path: data.target_path ?? null,
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
    // Candidates: Premium (paid subscription or active Promotional Trial --
    // Priority 8.7, R-1) users not yet verified.
    const ids = [...(await resolvePremiumStatusBulk(supabaseAdmin)).keys()];
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

    // Priority 16: only a genuine false->true transition is a real
    // approval -- an admin re-confirming an already-verified user (or
    // rejecting one) must never grant the reward again.
    const { data: before } = await supabaseAdmin
      .from("profiles")
      .select("is_verified")
      .eq("id", data.user_id)
      .maybeSingle();
    const isNewApproval = data.verified && !before?.is_verified;

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

    if (isNewApproval) {
      const { grantRewardAction } = await import("@/lib/rewards.server");
      await grantRewardAction({
        userId: data.user_id,
        action: "verification",
        dedupeKey: `verification:${data.user_id}`,
      });
    }

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
// rule is defined once here, not duplicated per schema. Exported (Priority
// 8.11) so the /v1 admin Applications endpoints reuse the exact same rule
// instead of re-typing it -- see src/routes/v1/admin/applications/*.
export const appSlugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only");

// Priority 8.7 (R-9): normalized the same way the Application Resolver
// normalizes an incoming request's Host header (extractHostname() in
// application-resolver.functions.ts) -- an admin typing `Muzika.BA` (or
// pasting a domain with any uppercase/whitespace) would otherwise silently
// and permanently break resolution for that application, since the
// resolver's exact-match lookup is already lowercase. Exported (Priority
// 8.11) for the same reason as appSlugSchema above.
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .nullable()
  .optional();

const appCreateSchema = z.object({
  name: z.string().min(1),
  slug: appSlugSchema,
  domain: domainSchema,
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
    // New applications start as visibility='draft' (the column's own DB
    // DEFAULT, Priority 8.9) -- hidden from every normal user, visible only
    // to administrators, until an explicit adminSetApplicationVisibility
    // call moves it forward. No half-configured app ever appears live
    // immediately.
    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .insert(data)
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

// ---------- Application Visibility (Priority 8.9) ----------
// One single visibility state per application -- draft/coming_soon/active/
// archived -- replacing the earlier status+is_enabled pair (see the
// migration that dropped both). Kept as its own dedicated action, separate
// from adminUpdateAppSettings below, matching this codebase's existing
// pattern of state-machine transitions (adminSetVerified, adminSetUserActive)
// being distinct from general field edits -- never bundled silently into a
// generic "save settings" call. Moving from coming_soon to active is always
// this explicit call; nothing in this codebase ever flips it automatically
// based on launch_date or any other signal.
const VISIBILITY_VALUES = ["draft", "coming_soon", "active", "archived"] as const;

const visibilitySchema = z.object({
  app_id: z.string().uuid(),
  visibility: z.enum(VISIBILITY_VALUES),
  reason: z.string().trim().max(500).optional(),
});

export const adminSetApplicationVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => visibilitySchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: previous } = await supabaseAdmin
      .from("applications")
      .select("visibility")
      .eq("id", data.app_id)
      .maybeSingle();

    const { data: row, error } = await supabaseAdmin
      .from("applications")
      .update({ visibility: data.visibility })
      .eq("id", data.app_id)
      .select("id, visibility")
      .single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: "application.visibility_change",
      entityType: "application",
      entityId: data.app_id,
      oldData: { visibility: previous?.visibility ?? null },
      newData: { visibility: data.visibility },
      reason: data.reason ?? null,
    });
    return row;
  });

// ---------- App settings (identity, branding, logo, favicon, descriptions) ----------
// Extensible by design: every field here is optional except app_id, so
// adding another editable application setting in the future means adding
// one more optional key to this schema and one more <Field>/<DescField>
// in AppSettings (src/routes/admin.applications.tsx) -- not a new
// function, route, or admin UI pattern. Visibility itself is deliberately
// NOT part of this schema -- see adminSetApplicationVisibility above.

const appSettingsSchema = z.object({
  app_id: z.string().uuid(),
  name: z.string().min(1).optional(),
  slug: appSlugSchema.optional(),
  domain: domainSchema,
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
  // Priority 8.9: informational only, never read by any activation logic.
  launch_date: z.string().datetime().nullable().optional(),
  // Priority 8.9: localization resolution order step 3 (see
  // PROJECT_KNOWLEDGE.md -> Authentication -> Localization).
  default_language: z.enum(["bs", "en", "de"]).nullable().optional(),
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
