// Priority 15 Phase B: Missions, Challenges & Streaks -- the engagement
// processing pipeline. This file never calls, wraps, or replaces
// recordEvent() (events.server.ts) or grantRewardAction() (rewards.server.ts)
// -- it is invoked AFTER a qualifying event has already been recorded, from
// the /v1/events route handler only, and never mutates event recording or
// reward-rule evaluation. See PROJECT_KNOWLEDGE.md -> Missions, Challenges &
// Streaks.
import type { Json } from "@/integrations/supabase/types";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type SupabaseAdmin = Awaited<ReturnType<typeof admin>>;

export type ProcessEngagementParams = {
  appId: string;
  eventKey: string;
  recipientUserId: string;
};

// Entry point -- called from src/routes/v1/events/index.ts only when
// recordEvent() returned granted:true (a real, points>0 occurrence, the
// same "qualifying" signal recordEvent()'s own cooldown/limit counters
// already use). Never throws -- a bug here must never break event
// recording, the API response, or authentication.
export async function processEngagement(params: ProcessEngagementParams): Promise<void> {
  try {
    const supabaseAdmin = await admin();
    await Promise.all([
      processEngagementDefinitions(supabaseAdmin, params),
      processStreaks(supabaseAdmin, params),
    ]);
  } catch (error) {
    console.error("processEngagement failed", error);
  }
}

// ---------- Missions & Challenges ----------

type EngagementDefinitionRow = {
  id: string;
  kind: string;
  key: string;
  app_id: string | null;
  reward_points: number;
  reward_lifetime_points: number;
  reward_grant_type: string | null;
  reward_grant_value: unknown;
  starts_at: string | null;
  ends_at: string | null;
};

async function processEngagementDefinitions(
  supabaseAdmin: SupabaseAdmin,
  { appId, eventKey, recipientUserId }: ProcessEngagementParams,
): Promise<void> {
  const { data: conditions } = await supabaseAdmin
    .from("engagement_conditions")
    .select("definition_id, engagement_definitions!inner(*)")
    .eq("event_key", eventKey)
    .eq("engagement_definitions.enabled", true)
    .eq("engagement_definitions.archived", false);
  if (!conditions || conditions.length === 0) return;

  const now = new Date();
  const definitionIds = new Set<string>();
  for (const row of conditions) {
    if (!row.engagement_definitions) continue;
    definitionIds.add(row.definition_id);
  }

  for (const row of conditions) {
    const definition = row.engagement_definitions as unknown as EngagementDefinitionRow;
    if (!definition || !definitionIds.has(row.definition_id)) continue;
    definitionIds.delete(row.definition_id); // process each definition at most once

    if (definition.app_id !== null && definition.app_id !== appId) continue;
    if (definition.starts_at && new Date(definition.starts_at) > now) continue;
    if (definition.ends_at && new Date(definition.ends_at) < now) continue;

    const { data: existing } = await supabaseAdmin
      .from("user_engagement_completions")
      .select("id")
      .eq("user_id", recipientUserId)
      .eq("definition_id", definition.id)
      .maybeSingle();
    if (existing) continue;

    const { data: allConditions } = await supabaseAdmin
      .from("engagement_conditions")
      .select("event_key, target")
      .eq("definition_id", definition.id);

    let allMet = (allConditions?.length ?? 0) > 0;
    for (const cond of allConditions ?? []) {
      let query = supabaseAdmin
        .from("reward_ledger")
        .select("id", { count: "exact", head: true })
        .eq("user_id", recipientUserId)
        .eq("action", cond.event_key)
        .gt("points", 0);
      if (definition.starts_at) query = query.gte("created_at", definition.starts_at);
      if (definition.ends_at) query = query.lte("created_at", definition.ends_at);
      if (definition.app_id !== null) query = query.eq("source_app_id", definition.app_id);
      const { count } = await query;
      if ((count ?? 0) < cond.target) {
        allMet = false;
        break;
      }
    }
    if (!allMet) continue;

    await completeEngagementDefinition(supabaseAdmin, recipientUserId, definition);
  }
}

async function completeEngagementDefinition(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
  definition: EngagementDefinitionRow,
): Promise<void> {
  // Insert the completion row FIRST -- ignoreDuplicates means a race
  // between two qualifying events both crossing the target produces one
  // winner and one safely-ignored duplicate, the same pattern
  // user_achievements already uses.
  const { data: inserted, error } = await supabaseAdmin
    .from("user_engagement_completions")
    .upsert(
      { user_id: userId, definition_id: definition.id },
      { onConflict: "user_id,definition_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("completeEngagementDefinition: completion insert failed", error);
    return;
  }
  if (!inserted) return; // already completed by a concurrent call

  let rewardLedgerId: string | null = null;
  let grantResult: Json | null = null;

  // Priority 15 Phase C: actually fulfills what's implemented (points/
  // premium_duration/vip/feature_access/advertising_credit) instead of
  // always recording pending_fulfillment -- see entitlements.server.ts's
  // fulfillGrant(), the one dispatcher every non-points reward path uses.
  if (definition.reward_grant_type) {
    const { fulfillGrant } = await import("@/lib/entitlements.server");
    const grantValue = (definition.reward_grant_value ?? {}) as Record<string, unknown>;
    const fulfillment = await fulfillGrant({
      grantType: definition.reward_grant_type,
      grantValue,
      userId,
      appId: definition.app_id,
      reason: `${definition.kind === "mission" ? "Mission" : "Challenge"} completed: ${definition.key}`,
      grantedBy: null,
      source: definition.kind === "mission" ? "mission_completion" : "challenge_completion",
    });
    grantResult = {
      status: fulfillment.status,
      grantType: definition.reward_grant_type,
      grantValue: grantValue as Json,
      entitlementId: fulfillment.entitlementId ?? null,
    };
  }

  const actionKey = definition.kind === "mission" ? "mission_completed" : "challenge_completed";

  if (definition.reward_points > 0 || definition.reward_lifetime_points > 0) {
    const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
      .from("reward_ledger")
      .insert({
        user_id: userId,
        action: actionKey,
        points: definition.reward_points,
        lifetime_points: definition.reward_lifetime_points,
        resource_type: definition.kind,
        resource_id: definition.id,
        source_app_id: definition.app_id,
        actor_user_id: userId,
        origin: "core",
        metadata: { definitionKey: definition.key } as Json,
      })
      .select("id")
      .single();
    if (ledgerErr) console.error("completeEngagementDefinition: reward_ledger insert failed", ledgerErr);
    else rewardLedgerId = ledgerRow.id;
  }

  await supabaseAdmin
    .from("user_engagement_completions")
    .update({ reward_ledger_id: rewardLedgerId, grant_result: grantResult })
    .eq("user_id", userId)
    .eq("definition_id", definition.id);

  if (rewardLedgerId) {
    const { checkAchievements } = await import("@/lib/rewards.server");
    await checkAchievements(userId, actionKey);
  }

  await notifyEngagementCompletion(supabaseAdmin, userId, definition);
}

const COMPLETION_TITLES: Record<string, { bs: string; en: string; de: string }> = {
  mission: { bs: "Misija završena!", en: "Mission completed!", de: "Mission abgeschlossen!" },
  challenge: { bs: "Izazov završen!", en: "Challenge completed!", de: "Herausforderung abgeschlossen!" },
};

async function notifyEngagementCompletion(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
  definition: EngagementDefinitionRow,
): Promise<void> {
  const { data: full } = await supabaseAdmin
    .from("engagement_definitions")
    .select("name_bs, name_en, name_de")
    .eq("id", definition.id)
    .maybeSingle();
  if (!full) return;
  const titles = COMPLETION_TITLES[definition.kind] ?? COMPLETION_TITLES.mission;
  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: userId,
    app_id: definition.app_id,
    type: "success",
    title_bs: titles.bs,
    title_en: titles.en,
    title_de: titles.de,
    message_bs: full.name_bs,
    message_en: full.name_en,
    message_de: full.name_de,
  });
  if (error) console.error("notifyEngagementCompletion: notification insert failed", error);
}

// ---------- Streaks ----------

type StreakDefinitionRow = {
  id: string;
  key: string;
  app_id: string | null;
};

async function getStreakTimezone(supabaseAdmin: SupabaseAdmin): Promise<string> {
  const { data } = await supabaseAdmin
    .from("engagement_config")
    .select("value")
    .eq("key", "streak_timezone")
    .maybeSingle();
  return typeof data?.value === "string" ? data.value : "Europe/Sarajevo";
}

// "Today" as a YYYY-MM-DD calendar date in the configured platform
// timezone (Priority 15 Phase B decision -- CORE has no per-user timezone
// concept; see the Phase B migration comment). Intl.DateTimeFormat is
// built into Node -- no new dependency.
function activityDateInTimezone(timezone: string, at: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(at);
}

async function processStreaks(
  supabaseAdmin: SupabaseAdmin,
  { appId, eventKey, recipientUserId }: ProcessEngagementParams,
): Promise<void> {
  const { data: streakDefs } = await supabaseAdmin
    .from("streak_definitions")
    .select("id, key, app_id")
    .eq("event_key", eventKey)
    .eq("enabled", true)
    .eq("archived", false);
  if (!streakDefs || streakDefs.length === 0) return;

  const timezone = await getStreakTimezone(supabaseAdmin);
  const activityDate = activityDateInTimezone(timezone, new Date());

  for (const def of streakDefs as StreakDefinitionRow[]) {
    if (def.app_id !== null && def.app_id !== appId) continue;

    const { data: rows, error } = await supabaseAdmin.rpc("advance_user_streak", {
      p_user_id: recipientUserId,
      p_streak_definition_id: def.id,
      p_activity_date: activityDate,
    });
    if (error) {
      console.error("processStreaks: advance_user_streak failed", error);
      continue;
    }
    const result = rows?.[0] as { current_streak: number; longest_streak: number; changed: boolean } | undefined;
    if (!result || !result.changed) continue; // same-day repeat -- nothing new to check

    const { data: milestones } = await supabaseAdmin
      .from("streak_milestones")
      .select("*")
      .eq("streak_definition_id", def.id)
      .lte("threshold_days", result.current_streak);
    for (const milestone of milestones ?? []) {
      await grantStreakMilestone(supabaseAdmin, recipientUserId, milestone, def);
    }
  }
}

type StreakMilestoneRow = {
  id: string;
  streak_definition_id: string;
  threshold_days: number;
  reward_points: number;
  reward_lifetime_points: number;
  reward_grant_type: string | null;
  reward_grant_value: unknown;
};

async function grantStreakMilestone(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
  milestone: StreakMilestoneRow,
  streakDef: StreakDefinitionRow,
): Promise<void> {
  const { data: inserted, error } = await supabaseAdmin
    .from("user_streak_milestones")
    .upsert(
      { user_id: userId, milestone_id: milestone.id },
      { onConflict: "user_id,milestone_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("grantStreakMilestone: milestone insert failed", error);
    return;
  }
  if (!inserted) return; // already granted

  let rewardLedgerId: string | null = null;
  let grantResult: Json | null = null;

  if (milestone.reward_grant_type) {
    const { fulfillGrant } = await import("@/lib/entitlements.server");
    const grantValue = (milestone.reward_grant_value ?? {}) as Record<string, unknown>;
    const fulfillment = await fulfillGrant({
      grantType: milestone.reward_grant_type,
      grantValue,
      userId,
      appId: streakDef.app_id,
      reason: `Streak milestone: ${streakDef.key} (${milestone.threshold_days} days)`,
      grantedBy: null,
      source: "streak_milestone",
    });
    grantResult = {
      status: fulfillment.status,
      grantType: milestone.reward_grant_type,
      grantValue: grantValue as Json,
      entitlementId: fulfillment.entitlementId ?? null,
    };
  }

  if (milestone.reward_points > 0 || milestone.reward_lifetime_points > 0) {
    const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
      .from("reward_ledger")
      .insert({
        user_id: userId,
        action: "streak_milestone",
        points: milestone.reward_points,
        lifetime_points: milestone.reward_lifetime_points,
        resource_type: "streak_milestone",
        resource_id: milestone.id,
        source_app_id: streakDef.app_id,
        actor_user_id: userId,
        origin: "core",
        metadata: { streakDefinitionKey: streakDef.key, thresholdDays: milestone.threshold_days } as Json,
      })
      .select("id")
      .single();
    if (ledgerErr) console.error("grantStreakMilestone: reward_ledger insert failed", ledgerErr);
    else rewardLedgerId = ledgerRow.id;
  }

  await supabaseAdmin
    .from("user_streak_milestones")
    .update({ reward_ledger_id: rewardLedgerId, grant_result: grantResult })
    .eq("user_id", userId)
    .eq("milestone_id", milestone.id);

  if (rewardLedgerId) {
    const { checkAchievements } = await import("@/lib/rewards.server");
    await checkAchievements(userId, "streak_milestone");
  }

  await notifyStreakMilestone(supabaseAdmin, userId, milestone, streakDef);
}

async function notifyStreakMilestone(
  supabaseAdmin: SupabaseAdmin,
  userId: string,
  milestone: StreakMilestoneRow,
  streakDef: StreakDefinitionRow,
): Promise<void> {
  const { data: full } = await supabaseAdmin
    .from("streak_definitions")
    .select("name_bs, name_en, name_de")
    .eq("id", streakDef.id)
    .maybeSingle();
  if (!full) return;
  const { error } = await supabaseAdmin.from("notifications").insert({
    user_id: userId,
    app_id: streakDef.app_id,
    type: "success",
    title_bs: `Niz od ${milestone.threshold_days} dana!`,
    title_en: `${milestone.threshold_days}-day streak!`,
    title_de: `${milestone.threshold_days}-Tage-Serie!`,
    message_bs: full.name_bs,
    message_en: full.name_en,
    message_de: full.name_de,
  });
  if (error) console.error("notifyStreakMilestone: notification insert failed", error);
}
