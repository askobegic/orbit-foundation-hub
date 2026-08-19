// CORE Notification & User Engagement System -- the one place a
// notification row is ever created. Every existing call site (messages,
// Premium milestones, admin broadcast, offers, application-reported
// events, entitlement grants, support replies, engagement/streak
// milestones) is expected to route through sendNotification() /
// sendBulkNotifications() rather than inserting into `notifications`
// directly, so preference enforcement, dedup and email delivery are
// implemented exactly once. See PROJECT_KNOWLEDGE.md -> Notifications &
// User Engagement.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email.server";
import type { NotificationCategory, NotificationType } from "@/types/database";

export interface NotificationContent {
  titleBs: string;
  titleEn: string;
  titleDe: string;
  messageBs: string;
  messageEn: string;
  messageDe: string;
}

function pickLocale(language: string | null | undefined): "bs" | "en" | "de" {
  return language === "en" || language === "de" ? language : "bs";
}

function pickContent(content: NotificationContent, locale: "bs" | "en" | "de") {
  if (locale === "en") return { title: content.titleEn, message: content.messageEn };
  if (locale === "de") return { title: content.titleDe, message: content.messageDe };
  return { title: content.titleBs, message: content.messageBs };
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

interface Recipient {
  email: string | null;
  language: string | null;
  notify_in_app: boolean;
  notify_email: boolean;
  email_disabled_categories: string[];
}

function emailAllowed(recipient: Recipient, category: NotificationCategory | null): boolean {
  if (!recipient.email || !recipient.notify_email) return false;
  if (category && recipient.email_disabled_categories.includes(category)) return false;
  return true;
}

// Single-recipient path: preference-aware, deduplicated, and (when
// applicable) emailed. Every parameter that can legitimately repeat for
// the same user (a milestone, an inactivity window, a specific message)
// should pass `dedupeKey` -- see the migration comment on
// notifications.dedupe_key for the exact idempotency guarantee this gives.
export async function sendNotification(params: {
  userId: string;
  appId?: string | null;
  category: NotificationCategory;
  type?: NotificationType;
  content: NotificationContent;
  targetPath?: string | null;
  dedupeKey?: string | null;
}): Promise<{ created: boolean; notificationId: string | null }> {
  const supabaseAdmin = await admin();

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email, language, notify_in_app, notify_email, email_disabled_categories")
    .eq("id", params.userId)
    .maybeSingle();
  if (!profile) return { created: false, notificationId: null };
  const recipient = profile as Recipient;
  if (!recipient.notify_in_app) return { created: false, notificationId: null };

  const row = {
    user_id: params.userId,
    app_id: params.appId ?? null,
    type: params.type ?? "info",
    category: params.category,
    target_path: params.targetPath ?? null,
    dedupe_key: params.dedupeKey ?? null,
    title_bs: params.content.titleBs,
    title_en: params.content.titleEn,
    title_de: params.content.titleDe,
    message_bs: params.content.messageBs,
    message_en: params.content.messageEn,
    message_de: params.content.messageDe,
    email_status: emailAllowed(recipient, params.category) ? "pending" : "not_applicable",
  };

  const insert = params.dedupeKey
    ? supabaseAdmin
        .from("notifications")
        .upsert(row, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
        .select("id")
    : supabaseAdmin.from("notifications").insert(row).select("id");

  const { data: inserted, error } = await insert;
  if (error) {
    console.error("sendNotification: insert failed", params.category, error);
    return { created: false, notificationId: null };
  }
  const notificationId = (inserted?.[0] as { id: string } | undefined)?.id ?? null;
  // dedupeKey collided with an existing row -- ignoreDuplicates means
  // Postgres's ON CONFLICT DO NOTHING silently skipped this insert, so
  // `inserted` comes back empty. Not an error; just nothing new to do.
  if (!notificationId) return { created: false, notificationId: null };

  if (emailAllowed(recipient, params.category) && recipient.email) {
    const locale = pickLocale(recipient.language);
    const { title, message } = pickContent(params.content, locale);
    const result = await sendEmail({
      to: recipient.email,
      subject: title,
      html: `<p>${message}</p>`,
    });
    await supabaseAdmin
      .from("notifications")
      .update({
        email_status: result.ok ? "sent" : "failed",
        email_error: result.ok ? null : (result.error ?? null),
      })
      .eq("id", notificationId);
  }

  return { created: true, notificationId };
}

// Bulk path (admin broadcast, global/segment offer publish): in-app only,
// deliberately not synchronous per-recipient email -- this codebase has no
// background job queue, and emailing hundreds/thousands of recipients
// inline would block the admin action that triggered it. Still respects
// notify_in_app (skips users who opted out) and the same dedupeKey
// idempotency as the single-recipient path.
export async function sendBulkNotifications(params: {
  userIds: string[];
  appId?: string | null;
  category: NotificationCategory;
  type?: NotificationType;
  content: NotificationContent;
  targetPath?: string | null;
  dedupeKey?: string | null;
}): Promise<{ sent: number }> {
  if (params.userIds.length === 0) return { sent: 0 };
  const supabaseAdmin = await admin();

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, notify_in_app")
    .in("id", params.userIds);
  const eligibleIds = ((profiles ?? []) as { id: string; notify_in_app: boolean }[])
    .filter((p) => p.notify_in_app)
    .map((p) => p.id);
  if (eligibleIds.length === 0) return { sent: 0 };

  const rows = eligibleIds.map((userId) => ({
    user_id: userId,
    app_id: params.appId ?? null,
    type: params.type ?? "info",
    category: params.category,
    target_path: params.targetPath ?? null,
    dedupe_key: params.dedupeKey ?? null,
    title_bs: params.content.titleBs,
    title_en: params.content.titleEn,
    title_de: params.content.titleDe,
    message_bs: params.content.messageBs,
    message_en: params.content.messageEn,
    message_de: params.content.messageDe,
  }));

  const insert = params.dedupeKey
    ? supabaseAdmin
        .from("notifications")
        .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true })
        .select("id")
    : supabaseAdmin.from("notifications").insert(rows).select("id");

  const { data: inserted, error } = await insert;
  if (error) {
    console.error("sendBulkNotifications: insert failed", params.category, error);
    return { sent: 0 };
  }
  return { sent: inserted?.length ?? 0 };
}

const INACTIVITY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// The inactivity reminder sweep. No cron infrastructure exists in this
// codebase (see PROJECT_KNOWLEDGE.md's repeated "evaluated lazily, no
// cron" precedent) -- this function is the eligibility+send logic only;
// something external actually has to call it periodically (an admin
// button, or a scheduler hitting the protected /v1/system/inactivity-sweep
// endpoint -- see that route file). Idempotent: dedupeKey is derived from
// each user's own last_active_at, so it can safely be called as often as
// desired -- a user already reminded for their current inactivity window
// is silently skipped (the upsert in sendNotification no-ops), and a new
// reminder only becomes possible again once last_active_at moves forward
// (they came back, then went inactive again).
export async function runInactivityReminderSweep(): Promise<{ scanned: number; notified: number }> {
  const supabaseAdmin = await admin();
  const cutoff = new Date(Date.now() - INACTIVITY_THRESHOLD_MS).toISOString();

  const { data: candidates, error } = await supabaseAdmin
    .from("profiles")
    .select("id, last_active_at")
    .eq("is_active", true)
    .lt("last_active_at", cutoff);
  if (error) {
    console.error("runInactivityReminderSweep: query failed", error);
    return { scanned: 0, notified: 0 };
  }
  if (!candidates || candidates.length === 0) return { scanned: 0, notified: 0 };

  let notified = 0;
  for (const c of candidates as { id: string; last_active_at: string }[]) {
    const result = await sendNotification({
      userId: c.id,
      category: "inactivity",
      targetPath: "/dashboard",
      dedupeKey: `inactivity:${c.id}:${c.last_active_at}`,
      content: {
        titleBs: "Nedostajete nam!",
        titleEn: "We miss you!",
        titleDe: "Wir vermissen Sie!",
        messageBs: "Prošlo je 7 dana od vaše zadnje posjete. Dođite da vidite šta ste propustili.",
        messageEn: "It's been 7 days since your last visit. Come see what you've missed.",
        messageDe: "Es sind 7 Tage seit Ihrem letzten Besuch vergangen. Schauen Sie vorbei.",
      },
    });
    if (result.created) notified++;
  }
  return { scanned: candidates.length, notified };
}

// Resolves an audience the same way admin broadcast/offers already define
// segments elsewhere (adminSendNotification, resolveMyOffers) -- not a
// second segment vocabulary.
export async function resolveAudience(
  supabaseAdmin: SupabaseClient,
  segment: "all" | "standard" | "premium",
): Promise<string[]> {
  if (segment === "premium") {
    const { resolvePremiumStatusBulk } = await import("@/lib/premium.server");
    return [...(await resolvePremiumStatusBulk(supabaseAdmin)).keys()];
  }
  if (segment === "standard") {
    const { resolvePremiumStatusBulk } = await import("@/lib/premium.server");
    const premiumIds = new Set((await resolvePremiumStatusBulk(supabaseAdmin)).keys());
    const { data: profs } = await supabaseAdmin.from("profiles").select("id");
    return ((profs ?? []) as { id: string }[]).map((r) => r.id).filter((id) => !premiumIds.has(id));
  }
  const { data: profs } = await supabaseAdmin.from("profiles").select("id");
  return ((profs ?? []) as { id: string }[]).map((r) => r.id);
}
