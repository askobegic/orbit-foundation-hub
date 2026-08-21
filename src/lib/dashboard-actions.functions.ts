// CORE User Engagement & Dashboard Actions -- a generic, CORE-wide
// mechanism for the central Dashboard to show relevant offers, actions,
// pending/completion prompts, and discovery opportunities, without CORE
// ever implementing an individual application's business logic (spec
// section 2). See PROJECT_KNOWLEDGE.md -> User Engagement & Dashboard
// Actions.
//
// Deliberately separate from offers.functions.ts (dashboard_offers,
// Priority 17): that module is a commercial discount promotion tied to a
// real purchasable product; this module has no product/discount concept
// at all -- a generic title/CTA/destination, optionally scoped to an
// application (an "Application-Provided Action") or gated on the user not
// yet having a given resource_references row (an "Open your Shop"-style
// prompt). Audience targeting reuses the existing offer_segments registry
// and resolveAudience()/notification pipeline rather than inventing a
// second targeting or notification system.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, writeAuditLog } from "@/lib/admin.server";
import { hasAnyActivePremium } from "@/lib/premium";
import { resolveAudience, sendBulkNotifications, sendNotification } from "@/lib/notify.server";
import { isSafeProfileUrl } from "@/lib/url";

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// A destination may be an internal relative path ("/dashboard/profile") or
// an absolute http(s) URL to another CORE-connected application's own
// domain ("https://eshop.ba/my-shop") -- unlike notifications.target_path
// (CORE-internal deep links only), Dashboard Actions must be able to point
// at a different application's own deployment (CLAUDE.md's Core/
// Application boundary), so this can't reuse that column's narrower
// ^/dashboard/... constraint. Rejects scheme-relative ("//host/...", a
// known open-redirect-style bypass for a "starts with /" check) and any
// non-http(s) scheme (CO-1's "validate before storage" rule).
export function isSafeDashboardDestination(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  return isSafeProfileUrl(value);
}

type ActionType = "offer" | "action" | "complete_task" | "discovery";

async function notifyActionPublished(
  supabaseAdmin: Awaited<ReturnType<typeof adminClient>>,
  action: {
    id: string;
    action_type: ActionType;
    target_type: "segment" | "individual";
    target_segment: "all" | "standard" | "premium" | null;
    target_user_id: string | null;
    app_id: string | null;
    title_bs: string;
    title_en: string;
    title_de: string;
  },
): Promise<void> {
  const content = {
    titleBs: "Nova preporuka za vas",
    titleEn: "A new recommendation for you",
    titleDe: "Eine neue Empfehlung für Sie",
    messageBs: action.title_bs,
    messageEn: action.title_en,
    messageDe: action.title_de,
  };
  // Reuses the existing category vocabulary (types/database.ts) -- 'offer'
  // for action_type='offer', 'information' for everything else, rather
  // than adding a new category for this feature.
  const category = action.action_type === "offer" ? "offer" : "information";
  const dedupeKey = `dashboard_action:${action.id}`;
  const targetPath = "/dashboard";

  if (action.target_type === "individual") {
    if (!action.target_user_id) return;
    await sendNotification({
      userId: action.target_user_id,
      appId: action.app_id,
      category,
      targetPath,
      dedupeKey,
      content,
    });
    return;
  }
  if (!action.target_segment) return;
  const userIds = await resolveAudience(supabaseAdmin, action.target_segment);
  await sendBulkNotifications({
    userIds,
    appId: action.app_id,
    category,
    targetPath,
    dedupeKey,
    content,
  });
}

export interface ResolvedDashboardAction {
  id: string;
  actionType: ActionType;
  appId: string | null;
  appName: string | null;
  titleBs: string;
  titleEn: string;
  titleDe: string;
  descriptionBs: string | null;
  descriptionEn: string | null;
  descriptionDe: string | null;
  ctaBs: string | null;
  ctaEn: string | null;
  ctaDe: string | null;
  icon: string | null;
  destination: string;
  displayOrder: number;
}

type DashboardActionRow = {
  id: string;
  action_type: ActionType;
  app_id: string | null;
  target_type: "segment" | "individual";
  target_segment: "all" | "standard" | "premium" | null;
  target_user_id: string | null;
  requires_missing_resource_type: string | null;
  title_bs: string;
  title_en: string;
  title_de: string;
  description_bs: string | null;
  description_en: string | null;
  description_de: string | null;
  cta_bs: string | null;
  cta_en: string | null;
  cta_de: string | null;
  icon: string | null;
  destination: string;
  starts_at: string | null;
  ends_at: string | null;
  display_order: number;
};

// ---------- Public: resolve the current user's eligible dashboard actions ----------

export const resolveMyDashboardActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ResolvedDashboardAction[]> => {
    const now = Date.now();
    const supabaseAdmin = await adminClient();

    // RLS already scopes this to eligible rows (own individual actions +
    // every enabled segment-targeted one); segment matching, the optional
    // date window, and the resource-presence gate are all re-checked here
    // explicitly, the same "RLS is the safe boundary, business filtering
    // is a server function" split dashboard_offers already established.
    const { data: rows } = await context.supabase
      .from("dashboard_actions")
      .select("*")
      .order("display_order", { ascending: false });
    if (!rows || rows.length === 0) return [];

    const isPremium = await hasAnyActivePremium(context.userId);

    const withinWindow = (row: DashboardActionRow) => {
      if (row.starts_at && new Date(row.starts_at).getTime() > now) return false;
      if (row.ends_at && new Date(row.ends_at).getTime() < now) return false;
      return true;
    };

    const matchesAudience = (row: DashboardActionRow) => {
      if (row.target_type === "individual") return row.target_user_id === context.userId;
      if (row.target_segment === "all") return true;
      if (row.target_segment === "standard") return !isPremium;
      if (row.target_segment === "premium") return isPremium;
      return false;
    };

    let candidates = (rows as DashboardActionRow[]).filter(
      (r) => withinWindow(r) && matchesAudience(r),
    );

    // Resource-presence gate: only fetch the user's own resource types
    // when at least one candidate actually needs it.
    const neededTypes = [
      ...new Set(
        candidates.map((r) => r.requires_missing_resource_type).filter((t): t is string => !!t),
      ),
    ];
    if (neededTypes.length > 0) {
      const { data: owned } = await context.supabase
        .from("resource_references")
        .select("app_id, resource_type")
        .eq("user_id", context.userId)
        .in("resource_type", neededTypes);
      const ownedKeys = new Set((owned ?? []).map((o) => `${o.app_id}:${o.resource_type}`));
      candidates = candidates.filter((r) => {
        if (!r.requires_missing_resource_type) return true;
        return !ownedKeys.has(`${r.app_id}:${r.requires_missing_resource_type}`);
      });
    }

    if (candidates.length === 0) return [];

    const appIds = [...new Set(candidates.map((r) => r.app_id).filter((id): id is string => !!id))];
    const appNameById = new Map<string, string>();
    if (appIds.length > 0) {
      const { data: apps } = await supabaseAdmin
        .from("applications")
        .select("id, name")
        .in("id", appIds);
      for (const a of apps ?? []) appNameById.set(a.id, a.name);
    }

    return candidates
      .map((r) => ({
        id: r.id,
        actionType: r.action_type,
        appId: r.app_id,
        appName: r.app_id ? (appNameById.get(r.app_id) ?? null) : null,
        titleBs: r.title_bs,
        titleEn: r.title_en,
        titleDe: r.title_de,
        descriptionBs: r.description_bs,
        descriptionEn: r.description_en,
        descriptionDe: r.description_de,
        ctaBs: r.cta_bs,
        ctaEn: r.cta_en,
        ctaDe: r.cta_de,
        icon: r.icon,
        destination: r.destination,
        displayOrder: r.display_order,
      }))
      .sort((a, b) => b.displayOrder - a.displayOrder);
  });

// ---------- Public: the current user's own resource references ("My Resources") ----------

export const getMyResourceReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("resource_references")
      .select("*, applications(name, logo_url)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    return data ?? [];
  });

// ---------- Admin: Dashboard Actions ----------

export const adminListDashboardActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { data } = await supabaseAdmin
      .from("dashboard_actions")
      .select(
        "*, applications(name), target_user:profiles!dashboard_actions_target_user_id_fkey(id, username, first_name, last_name)",
      )
      .eq("archived", false)
      .order("display_order", { ascending: false });
    return data ?? [];
  });

const actionUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  actionType: z.enum(["offer", "action", "complete_task", "discovery"]),
  appId: z.string().uuid().nullable().optional(),
  targetType: z.enum(["segment", "individual"]),
  targetSegment: z.string().min(1).optional(),
  targetUserId: z.string().uuid().optional(),
  requiresMissingResourceType: z.string().trim().min(1).optional(),
  titleBs: z.string().min(1),
  titleEn: z.string().min(1),
  titleDe: z.string().min(1),
  descriptionBs: z.string().optional(),
  descriptionEn: z.string().optional(),
  descriptionDe: z.string().optional(),
  ctaBs: z.string().optional(),
  ctaEn: z.string().optional(),
  ctaDe: z.string().optional(),
  icon: z.string().optional(),
  destination: z.string().min(1),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  displayOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
});

export const adminUpsertDashboardAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => actionUpsertSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    if (!isSafeDashboardDestination(data.destination)) {
      throw new Error("Destination must be an internal path or an http(s) URL.");
    }
    if (data.targetType === "segment" && !data.targetSegment) {
      throw new Error("targetSegment is required for a segment-targeted action.");
    }
    if (data.targetType === "individual" && !data.targetUserId) {
      throw new Error("targetUserId is required for an individual action.");
    }

    let previous: unknown = null;
    if (data.id) {
      const { data: existing } = await supabaseAdmin
        .from("dashboard_actions")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      previous = existing;
    }

    const payload = {
      action_type: data.actionType,
      app_id: data.appId ?? null,
      target_type: data.targetType,
      target_segment: data.targetType === "segment" ? data.targetSegment : null,
      target_user_id: data.targetType === "individual" ? data.targetUserId : null,
      requires_missing_resource_type: data.requiresMissingResourceType ?? null,
      title_bs: data.titleBs,
      title_en: data.titleEn,
      title_de: data.titleDe,
      description_bs: data.descriptionBs ?? null,
      description_en: data.descriptionEn ?? null,
      description_de: data.descriptionDe ?? null,
      cta_bs: data.ctaBs ?? null,
      cta_en: data.ctaEn ?? null,
      cta_de: data.ctaDe ?? null,
      icon: data.icon ?? null,
      destination: data.destination,
      starts_at: data.startsAt ?? null,
      ends_at: data.endsAt ?? null,
      display_order: data.displayOrder,
      enabled: data.enabled,
      created_by: context.userId,
    };

    const { data: saved, error } = data.id
      ? await supabaseAdmin
          .from("dashboard_actions")
          .update(payload)
          .eq("id", data.id)
          .select("id")
          .single()
      : await supabaseAdmin.from("dashboard_actions").insert(payload).select("id").single();
    if (error) throw new Error(error.message);

    await writeAuditLog({
      userId: context.userId,
      action: data.id ? "dashboard_action.updated" : "dashboard_action.created",
      entityType: "dashboard_action",
      entityId: (saved as { id: string }).id,
      oldData: previous,
      newData: payload,
    });

    // Same "only a brand-new, already-enabled row counts as publish" rule
    // as dashboard_offers -- editing an existing action never re-notifies.
    if (!data.id && data.enabled) {
      await notifyActionPublished(supabaseAdmin, {
        id: (saved as { id: string }).id,
        action_type: data.actionType,
        target_type: data.targetType,
        target_segment: (payload.target_segment as "all" | "standard" | "premium" | null) ?? null,
        target_user_id: payload.target_user_id ?? null,
        app_id: payload.app_id,
        title_bs: data.titleBs,
        title_en: data.titleEn,
        title_de: data.titleDe,
      });
    }

    return { id: (saved as { id: string }).id };
  });

export const adminArchiveDashboardAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { error } = await supabaseAdmin
      .from("dashboard_actions")
      .update({ archived: true, enabled: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "dashboard_action.archived",
      entityType: "dashboard_action",
      entityId: data.id,
    });
    return { ok: true };
  });

export const adminSetDashboardActionEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();

    const { data: previous } = await supabaseAdmin
      .from("dashboard_actions")
      .select(
        "enabled, action_type, app_id, target_type, target_segment, target_user_id, title_bs, title_en, title_de",
      )
      .eq("id", data.id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("dashboard_actions")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "dashboard_action.set_enabled",
      entityType: "dashboard_action",
      entityId: data.id,
      newData: { enabled: data.enabled },
    });

    if (previous && !previous.enabled && data.enabled) {
      await notifyActionPublished(supabaseAdmin, {
        id: data.id,
        action_type: previous.action_type as ActionType,
        target_type: previous.target_type as "segment" | "individual",
        target_segment: previous.target_segment as "all" | "standard" | "premium" | null,
        target_user_id: previous.target_user_id,
        app_id: previous.app_id,
        title_bs: previous.title_bs,
        title_en: previous.title_en,
        title_de: previous.title_de,
      });
    }

    return { ok: true };
  });

// ---------- Admin: Resource References (support/testing -- see PROJECT_KNOWLEDGE.md) ----------

export const adminListResourceReferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ search: z.string().trim().optional() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    let query = supabaseAdmin
      .from("resource_references")
      .select(
        "*, applications(name), profiles!resource_references_user_id_fkey(id, username, first_name, last_name)",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.search) {
      // Matched against the joined profile client-side below is not
      // possible via PostgREST .or() across a relation, so this searches
      // resource_type/label only -- a targeted user lookup is better done
      // from the Manage User modal (Admin User 360).
      query = query.or(`resource_type.ilike.%${data.search}%,label.ilike.%${data.search}%`);
    }
    const { data: rows } = await query;
    return rows ?? [];
  });

const resourceUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  userId: z.string().uuid(),
  appId: z.string().uuid(),
  resourceType: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1),
  status: z.enum(["active", "pending", "incomplete", "inactive"]).default("active"),
  destination: z.string().trim().optional(),
});

export const adminUpsertResourceReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => resourceUpsertSchema.parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.destination && !isSafeDashboardDestination(data.destination)) {
      throw new Error("Destination must be an internal path or an http(s) URL.");
    }
    const supabaseAdmin = await adminClient();
    const payload = {
      user_id: data.userId,
      app_id: data.appId,
      resource_type: data.resourceType,
      label: data.label,
      status: data.status,
      destination: data.destination ?? null,
    };
    const { data: saved, error } = await supabaseAdmin
      .from("resource_references")
      .upsert(payload, { onConflict: "user_id,app_id,resource_type" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "resource_reference.upserted",
      entityType: "resource_reference",
      entityId: (saved as { id: string }).id,
      newData: payload,
    });
    return { id: (saved as { id: string }).id };
  });

export const adminDeleteResourceReference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = await adminClient();
    const { error } = await supabaseAdmin.from("resource_references").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      userId: context.userId,
      action: "resource_reference.deleted",
      entityType: "resource_reference",
      entityId: data.id,
    });
    return { ok: true };
  });
