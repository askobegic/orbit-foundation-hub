import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";

export async function assertAdmin(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Response("Forbidden", { status: 403 });
}

export async function writeAuditLog(params: {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldData?: unknown;
  newData?: unknown;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    user_id: params.userId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    old_data: (params.oldData ?? null) as Json,
    new_data: (params.newData ?? null) as Json,
  });
  if (error) console.error("writeAuditLog: insert failed", params.action, error);
}

// Shared by the self-service GDPR deletion (gdpr.functions.ts) and the
// admin-initiated deletion (admin.functions.ts) -- one cascade-delete
// implementation, not duplicated per caller.
const USER_ID_KEYED_TABLES = [
  "user_app_settings",
  "notifications",
  "payments",
  "subscriptions",
  "premium_profiles",
  "user_roles",
] as const;

export async function deleteUserAccountCascade(params: {
  targetUserId: string;
  actorUserId: string;
  action: string;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("email, username")
    .eq("id", params.targetUserId)
    .maybeSingle();

  // Audit BEFORE deletion so it survives cascades.
  await supabaseAdmin.from("audit_logs").insert({
    user_id: params.actorUserId,
    action: params.action,
    entity_type: "user",
    entity_id: params.targetUserId,
    old_data: { email: profile?.email ?? null, username: profile?.username ?? null },
  });

  const failedTables: string[] = [];
  for (const t of USER_ID_KEYED_TABLES) {
    const { error } = await supabaseAdmin.from(t).delete().eq("user_id", params.targetUserId);
    if (error) {
      console.error("deleteUserAccountCascade: delete failed", t, error);
      failedTables.push(t);
    }
  }
  if (failedTables.length > 0) {
    throw new Error(
      `Account deletion incomplete, failed to delete from: ${failedTables.join(", ")}`,
    );
  }

  // Best-effort avatar cleanup -- doesn't block account deletion if it fails.
  const { data: avatarFiles } = await supabaseAdmin.storage
    .from("core")
    .list(`avatars/${params.targetUserId}`);
  if (avatarFiles && avatarFiles.length > 0) {
    const { error: storageErr } = await supabaseAdmin.storage
      .from("core")
      .remove(avatarFiles.map((f) => `avatars/${params.targetUserId}/${f.name}`));
    if (storageErr) console.error("deleteUserAccountCascade: avatar cleanup failed", storageErr);
  }

  // profiles is keyed by id (matches auth.users.id)
  const { error: profileDeleteErr } = await supabaseAdmin
    .from("profiles")
    .delete()
    .eq("id", params.targetUserId);
  if (profileDeleteErr) throw new Error(profileDeleteErr.message);

  const { error } = await supabaseAdmin.auth.admin.deleteUser(params.targetUserId);
  if (error) throw new Error(error.message);
}

export function addMonthsIso(months: number, from: Date = new Date()): string {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1); // avoid day-of-month overflow while changing the month
  d.setMonth(d.getMonth() + months);
  const daysInTargetMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTargetMonth));
  return d.toISOString();
}
