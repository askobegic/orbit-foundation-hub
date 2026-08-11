// Priority 12 Phase 3: Universal Event & Rewards Engine -- the event
// ingestion pipeline. Applications only ever call recordEvent(); they never
// calculate points themselves. This is entirely parallel to
// rewards.server.ts's grantRewardAction(), which remains the sole path for
// CORE-internal actions (webhooks, onboarding, admin grants) -- this file
// never calls, wraps, or replaces that one. See PROJECT_KNOWLEDGE.md ->
// Rewards & Loyalty / Universal Event Engine.
//
// Pipeline: application_events (is this event live for this app?) ->
// event_rules (is there a configured reward, and does it pass its
// cooldown/limits?) -> event_rule_conditions (do all configured predicates
// pass?) -> reward_ledger insert (always -- even a 0-point outcome is
// recorded, exactly like grantRewardAction's "unrecognized action still
// gets a row" precedent) -> achievement check (reused from rewards.server.ts
// -- an event-driven grant can complete the same achievements a
// CORE-internal action can, since both write the same reward_ledger).
//
// Priority 15 Phase A: event_rules.app_id may be null (a GLOBAL rule,
// available to every application) or a specific application (always
// overrides the global rule for the same event_key when both exist) --
// see resolveEventRule() below. application_events is unchanged: an
// application must still explicitly enable an event before any rule,
// global or app-specific, is ever evaluated for it.
import { hasAnyActivePremium } from "@/lib/premium";
import type { Json } from "@/integrations/supabase/types";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type RecordEventParams = {
  appId: string;
  eventKey: string;
  // Who performed the action. Defaults to recipientUserId when omitted --
  // the common case where actor and recipient are the same person.
  actorUserId?: string | null;
  // Who is rewarded. Required -- unlike actorUserId, there is no sensible
  // default for "who gets the points."
  recipientUserId: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  dedupeKey?: string | null;
  // 'api' for the public /v1/events endpoint (the normal path). 'application'
  // and 'n8n' are reserved for non-REST integration paths that don't exist
  // yet -- see the Phase 1 migration's origin CHECK constraint comment.
  origin: "api" | "application" | "n8n";
};

export type RecordEventResult = {
  granted: boolean;
  points: number;
  lifetimePoints: number;
  reason?: string;
};

type ConditionRow = { condition_type: string; params: unknown };

type ConditionContext = {
  supabaseAdmin: Awaited<ReturnType<typeof admin>>;
  appId: string;
  eventKey: string;
  actorUserId: string;
  recipientUserId: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  params: Record<string, unknown>;
};

// A small, code-implemented, growing set of predicates -- see the
// event_rule_conditions comment in the Phase 1 migration for why this is
// the deliberate tradeoff (same as reward_fulfillment_types: which
// conditions apply and their thresholds are admin-configurable without
// code, but a genuinely new predicate type needs a code change).
const CONDITION_EVALUATORS: Record<string, (ctx: ConditionContext) => Promise<boolean>> = {
  // Actor and recipient must differ -- e.g. liking your own photo doesn't
  // reward you.
  not_self: async (ctx) => ctx.actorUserId !== ctx.recipientUserId,

  // Passes only the first time this recipient is rewarded for this event
  // on this specific resource (e.g. liking/unliking/re-liking the same
  // photo can't be farmed) -- distinct from event_rules.max_executions,
  // which caps executions across all resources.
  first_occurrence: async (ctx) => {
    if (!ctx.resourceId) return true;
    const { count } = await ctx.supabaseAdmin
      .from("reward_ledger")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.recipientUserId)
      .eq("action", ctx.eventKey)
      .eq("resource_id", ctx.resourceId)
      .gt("points", 0);
    return (count ?? 0) === 0;
  },

  // params: { days: number } -- the actor's account must be at least this
  // many days old.
  min_account_age_days: async (ctx) => {
    const days = Number(ctx.params.days ?? 0);
    if (!days) return true;
    const { data } = await ctx.supabaseAdmin
      .from("profiles")
      .select("created_at")
      .eq("id", ctx.actorUserId)
      .maybeSingle();
    if (!data?.created_at) return false;
    const ageMs = Date.now() - new Date(data.created_at).getTime();
    return ageMs >= days * 24 * 60 * 60 * 1000;
  },

  recipient_premium: async (ctx) => hasAnyActivePremium(ctx.recipientUserId),

  recipient_verified: async (ctx) => {
    const { data } = await ctx.supabaseAdmin
      .from("profiles")
      .select("is_verified")
      .eq("id", ctx.recipientUserId)
      .maybeSingle();
    return !!data?.is_verified;
  },

  recipient_profile_complete: async (ctx) => {
    const { data } = await ctx.supabaseAdmin
      .from("profiles")
      .select("profile_complete")
      .eq("id", ctx.recipientUserId)
      .maybeSingle();
    return !!data?.profile_complete;
  },

  // CORE never stores application content (photos, posts, etc. live in
  // each application's own separate database -- PROJECT_KNOWLEDGE.md ->
  // API architecture) so this cannot be independently verified here; it
  // trusts the calling application's own metadata.isPublic, the same trust
  // model as every other application-reported field on this event. Not a
  // gap specific to this predicate -- the whole /v1/events endpoint is
  // trusted at the level of "this application's JWT is valid."
  content_public: async (ctx) => ctx.metadata.isPublic === true,

  // The actor must be a verified referral (premium_referrals.verified_at
  // set) -- guards event keys like verified_referral from being claimed
  // without CORE's own referral-verification flow having actually run.
  referral_verified: async (ctx) => {
    const { data } = await ctx.supabaseAdmin
      .from("premium_referrals")
      .select("verified_at")
      .eq("referred_user_id", ctx.actorUserId)
      .maybeSingle();
    return !!data?.verified_at;
  },

  // The event's resourceId must reference a real, successful payments row
  // belonging to the recipient -- guards purchase-driven event keys
  // (premium_purchased, ticket_purchased, ...) from being claimed without
  // CORE's own billing engine having actually recorded the payment.
  payment_successful: async (ctx) => {
    if (!ctx.resourceId) return false;
    const { data } = await ctx.supabaseAdmin
      .from("payments")
      .select("status, user_id")
      .eq("id", ctx.resourceId)
      .maybeSingle();
    return !!data && data.status === "success" && data.user_id === ctx.recipientUserId;
  },

  // params: { field: string, operator: "gte" | "lte" | "eq", value: number }
  // -- a generic numeric check against a field the calling application
  // reported in this event's own metadata (e.g. only reward
  // video_uploaded when metadata.durationSeconds >= 30).
  metadata_threshold: async (ctx) => {
    const field = String(ctx.params.field ?? "");
    const operator = String(ctx.params.operator ?? "gte");
    const threshold = Number(ctx.params.value ?? 0);
    if (!field) return true;
    const actual = Number(ctx.metadata[field]);
    if (!Number.isFinite(actual)) return false;
    if (operator === "lte") return actual <= threshold;
    if (operator === "eq") return actual === threshold;
    return actual >= threshold;
  },
};

async function evaluateConditions(
  conditions: ConditionRow[],
  base: Omit<ConditionContext, "params">,
): Promise<{ passed: boolean; failedType?: string }> {
  for (const condition of conditions) {
    const evaluator = CONDITION_EVALUATORS[condition.condition_type];
    if (!evaluator) continue; // unrecognized predicate type -- fails open, same as an admin-only misconfiguration, never blocks the caller
    const params = (condition.params as Record<string, unknown>) ?? {};
    const passed = await evaluator({ ...base, params });
    if (!passed) return { passed: false, failedType: condition.condition_type };
  }
  return { passed: true };
}

// Priority 15 Phase A: Global vs Application scope. A rule with app_id set
// applies only to that application and always wins when present; a rule
// with app_id = null is the global fallback, consulted only when no
// application-specific rule exists for this (appId, eventKey) pair. Same
// override-with-global-fallback precedence already used by
// ad_config/ad_application_settings and ad_placement_prices -- not new
// behavior invented for this engine.
async function resolveEventRule(
  supabaseAdmin: Awaited<ReturnType<typeof admin>>,
  appId: string,
  eventKey: string,
) {
  const { data: appRule } = await supabaseAdmin
    .from("event_rules")
    .select("*")
    .eq("app_id", appId)
    .eq("event_key", eventKey)
    .maybeSingle();
  if (appRule) return appRule;

  const { data: globalRule } = await supabaseAdmin
    .from("event_rules")
    .select("*")
    .is("app_id", null)
    .eq("event_key", eventKey)
    .maybeSingle();
  return globalRule ?? null;
}

async function countSince(
  supabaseAdmin: Awaited<ReturnType<typeof admin>>,
  userId: string,
  eventKey: string,
  since: Date,
): Promise<number> {
  const { count } = await supabaseAdmin
    .from("reward_ledger")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", eventKey)
    .gt("points", 0)
    .gte("created_at", since.toISOString());
  return count ?? 0;
}

// Records a suspicious/rejected submission for admin review -- never a
// block, per the Phase 1 migration's event_abuse_flags comment. Flags on
// every limit/cooldown rejection rather than every rejection overall
// (e.g. not on a routine "event not configured for this app" outcome) --
// a repeated attempt to exceed a configured cap is the actual abuse
// signal named in Priority 12's brief.
async function flagForReview(params: {
  supabaseAdmin: Awaited<ReturnType<typeof admin>>;
  userId: string;
  eventKey: string;
  appId: string;
  reason: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const { error } = await params.supabaseAdmin.from("event_abuse_flags").insert({
    user_id: params.userId,
    event_key: params.eventKey,
    app_id: params.appId,
    reason: params.reason,
    metadata: params.metadata as Json,
  });
  if (error) console.error("flagForReview: insert failed", error);
}

export async function recordEvent(input: RecordEventParams): Promise<RecordEventResult> {
  const supabaseAdmin = await admin();
  const actorUserId = input.actorUserId ?? input.recipientUserId;
  const metadata = input.metadata ?? {};

  let points = 0;
  let lifetimePoints = 0;
  let reason: string | undefined;

  const { data: mapping } = await supabaseAdmin
    .from("application_events")
    .select("enabled")
    .eq("app_id", input.appId)
    .eq("event_key", input.eventKey)
    .maybeSingle();

  if (!mapping?.enabled) {
    reason = "event_not_enabled_for_app";
  } else {
    const rule = await resolveEventRule(supabaseAdmin, input.appId, input.eventKey);

    if (!rule || !rule.enabled || rule.archived) {
      reason = "rule_not_configured";
    } else {
      const { count: lifetimeCount } = await supabaseAdmin
        .from("reward_ledger")
        .select("id", { count: "exact", head: true })
        .eq("user_id", input.recipientUserId)
        .eq("action", input.eventKey)
        .gt("points", 0);
      const executions = lifetimeCount ?? 0;

      if (!rule.repeatable && executions >= 1) {
        reason = "not_repeatable";
      } else if (rule.max_executions !== null && executions >= rule.max_executions) {
        reason = "max_executions_reached";
        await flagForReview({
          supabaseAdmin,
          userId: input.recipientUserId,
          eventKey: input.eventKey,
          appId: input.appId,
          reason: "max_executions_exceeded",
          metadata,
        });
      } else if (rule.cooldown_seconds > 0) {
        const { data: lastGrant } = await supabaseAdmin
          .from("reward_ledger")
          .select("created_at")
          .eq("user_id", input.recipientUserId)
          .eq("action", input.eventKey)
          .gt("points", 0)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const cooledDownAt = lastGrant
          ? new Date(lastGrant.created_at).getTime() + rule.cooldown_seconds * 1000
          : 0;
        if (Date.now() < cooledDownAt) {
          reason = "cooldown_active";
        }
      }

      if (!reason && rule.daily_limit !== null) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (
          (await countSince(supabaseAdmin, input.recipientUserId, input.eventKey, since)) >=
          rule.daily_limit
        ) {
          reason = "daily_limit_reached";
          await flagForReview({
            supabaseAdmin,
            userId: input.recipientUserId,
            eventKey: input.eventKey,
            appId: input.appId,
            reason: "daily_limit_exceeded",
            metadata,
          });
        }
      }
      if (!reason && rule.weekly_limit !== null) {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        if (
          (await countSince(supabaseAdmin, input.recipientUserId, input.eventKey, since)) >=
          rule.weekly_limit
        ) {
          reason = "weekly_limit_reached";
          await flagForReview({
            supabaseAdmin,
            userId: input.recipientUserId,
            eventKey: input.eventKey,
            appId: input.appId,
            reason: "weekly_limit_exceeded",
            metadata,
          });
        }
      }
      if (!reason && rule.monthly_limit !== null) {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (
          (await countSince(supabaseAdmin, input.recipientUserId, input.eventKey, since)) >=
          rule.monthly_limit
        ) {
          reason = "monthly_limit_reached";
          await flagForReview({
            supabaseAdmin,
            userId: input.recipientUserId,
            eventKey: input.eventKey,
            appId: input.appId,
            reason: "monthly_limit_exceeded",
            metadata,
          });
        }
      }

      if (!reason) {
        const { data: conditions } = await supabaseAdmin
          .from("event_rule_conditions")
          .select("condition_type, params")
          .eq("rule_id", rule.id)
          .order("display_order", { ascending: true });

        const { passed, failedType } = await evaluateConditions(conditions ?? [], {
          supabaseAdmin,
          appId: input.appId,
          eventKey: input.eventKey,
          actorUserId,
          recipientUserId: input.recipientUserId,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          metadata,
        });

        if (!passed) {
          reason = `condition_failed:${failedType}`;
        } else {
          points = rule.points;
          lifetimePoints = rule.lifetime_points;
        }
      }
    }
  }

  const { error: insertError } = await supabaseAdmin.from("reward_ledger").insert({
    user_id: input.recipientUserId,
    action: input.eventKey,
    points,
    resource_type: input.resourceType ?? null,
    resource_id: input.resourceId ?? null,
    source_app_id: input.appId,
    actor_user_id: actorUserId,
    lifetime_points: lifetimePoints,
    origin: input.origin,
    metadata: metadata as Json,
    dedupe_key: input.dedupeKey ?? null,
  });
  if (insertError) {
    // A dedupe_key collision (idx_reward_ledger_dedupe) means this exact
    // event was already recorded -- not a real error, the expected outcome
    // of a retried/duplicated submission.
    if (insertError.code === "23505") {
      return { granted: false, points: 0, lifetimePoints: 0, reason: "duplicate" };
    }
    console.error("recordEvent: ledger insert failed", insertError);
    return { granted: false, points: 0, lifetimePoints: 0, reason: "insert_failed" };
  }

  if (points > 0) {
    const { checkAchievements } = await import("@/lib/rewards.server");
    await checkAchievements(input.recipientUserId, input.eventKey);
  }

  return { granted: points > 0, points, lifetimePoints, reason };
}
