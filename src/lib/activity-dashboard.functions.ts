// Priority 15 Phase E (15.14): Cross-App User Activity Dashboard. A pure
// aggregation layer -- creates no new activity storage, reuses
// reward_ledger (already the complete, per-user activity log), the
// existing reward_levels resolver shape, user_streaks, and entitlements.
// One user's own data only (RLS + explicit user_id scoping); a single
// reward_ledger query serves the per-app breakdown, the total, and the
// recent-activity feed together, avoiding N+1 -- see
// PROJECT_KNOWLEDGE.md -> Cross-App User Activity Dashboard.
//
// Priority 16 Phase D2: the aggregation itself is extracted into
// computeActivityDashboard() so the Admin User 360 modal's Activity tab
// (adminGetUserActivity, below) can reuse the exact same computation for
// an arbitrary target user instead of a second activity system -- the
// only difference is which Supabase client executes the queries
// (RLS-scoped `context.supabase` for the self-service caller vs
// `service_role` for an assertAdmin()-gated admin lookup of someone
// else's data, which RLS's own-row policies would otherwise block).
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/admin.server";

const RECENT_ACTIVITY_LIMIT = 15;

async function computeActivityDashboard(userId: string, supabase: SupabaseClient) {
  const [
    { data: ledgerRows },
    { data: appsRows },
    { data: userStreaks },
    { data: entitlements },
    { data: completions },
    { data: activeDefinitions },
  ] = await Promise.all([
    // One query backs the per-app breakdown, the total, and the recent
    // feed together -- bounded by this one user's own activity, never
    // the whole platform's.
    supabase
      .from("reward_ledger")
      .select(
        "action, points, lifetime_points, source_app_id, resource_type, resource_id, origin, created_at",
      )
      .eq("user_id", userId)
      .gt("points", 0)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("applications").select("id, name, sort_order").order("sort_order"),
    supabase
      .from("user_streaks")
      .select("current_streak, longest_streak, streak_definitions(key, name_bs, name_en, name_de)")
      .eq("user_id", userId)
      .gt("current_streak", 0),
    supabase
      .from("entitlements")
      .select("benefit_type, ends_at, app_id")
      .eq("user_id", userId)
      .eq("status", "active"),
    supabase.from("user_engagement_completions").select("definition_id").eq("user_id", userId),
    supabase
      .from("engagement_definitions")
      .select("id, kind")
      .eq("enabled", true)
      .eq("archived", false),
  ]);

  const appNameById = new Map((appsRows ?? []).map((a) => [a.id, a.name]));

  const byAppCounts = new Map<string, number>();
  let lifetimePoints = 0;
  for (const row of ledgerRows ?? []) {
    lifetimePoints += row.lifetime_points;
    const key = row.source_app_id ?? "core";
    byAppCounts.set(key, (byAppCounts.get(key) ?? 0) + 1);
  }
  const byApp = [...byAppCounts.entries()]
    .map(([appId, count]) => ({
      appId: appId === "core" ? null : appId,
      appName: appId === "core" ? "core" : (appNameById.get(appId) ?? "?"),
      count,
    }))
    .sort((a, b) => b.count - a.count);
  const totalActivity = ledgerRows?.length ?? 0;

  const { data: levels } = await supabase
    .from("reward_levels")
    .select("key, label")
    .eq("enabled", true)
    .eq("archived", false)
    .lte("min_lifetime_points", lifetimePoints)
    .order("min_lifetime_points", { ascending: false })
    .limit(1);

  const completedIds = new Set((completions ?? []).map((c) => c.definition_id));
  const missionsActive = (activeDefinitions ?? []).filter((d) => d.kind === "mission").length;
  const missionsCompleted = (activeDefinitions ?? []).filter(
    (d) => d.kind === "mission" && completedIds.has(d.id),
  ).length;
  const challengesActive = (activeDefinitions ?? []).filter((d) => d.kind === "challenge").length;
  const challengesCompleted = (activeDefinitions ?? []).filter(
    (d) => d.kind === "challenge" && completedIds.has(d.id),
  ).length;

  const streaks = (userStreaks ?? []).map((s) => {
    const def = s.streak_definitions as unknown as {
      key: string;
      name_bs: string;
      name_en: string;
      name_de: string;
    } | null;
    return {
      key: def?.key ?? "",
      nameBs: def?.name_bs ?? "",
      nameEn: def?.name_en ?? "",
      nameDe: def?.name_de ?? "",
      currentStreak: s.current_streak,
      longestStreak: s.longest_streak,
    };
  });

  return {
    totalActivity,
    byApp,
    lifetimePoints,
    level: levels?.[0] ?? null,
    streaks,
    missions: { active: missionsActive, completed: missionsCompleted },
    challenges: { active: challengesActive, completed: challengesCompleted },
    activeEntitlements: (entitlements ?? []).map((e) => ({
      benefitType: e.benefit_type,
      endsAt: e.ends_at,
      appName: e.app_id ? (appNameById.get(e.app_id) ?? "?") : null,
    })),
    recentActivity: (ledgerRows ?? []).slice(0, RECENT_ACTIVITY_LIMIT).map((r) => ({
      action: r.action,
      points: r.points,
      origin: r.origin,
      resourceType: r.resource_type,
      appName: r.source_app_id ? (appNameById.get(r.source_app_id) ?? "?") : "core",
      createdAt: r.created_at,
    })),
  };
}

export const getMyActivityDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => computeActivityDashboard(context.userId, context.supabase));

// Priority 16 Phase D2: Admin User 360 Activity tab -- same aggregation,
// an arbitrary target user, assertAdmin()-gated, service_role (RLS's
// own-row policies would otherwise block reading someone else's
// reward_ledger/entitlements/streaks).
export const adminGetUserActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ userId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return computeActivityDashboard(data.userId, supabaseAdmin);
  });
