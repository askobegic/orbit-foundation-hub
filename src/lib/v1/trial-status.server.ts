// Shared by /v1/admin/trials/{trialId}/end and .../revoke -- mechanically
// identical (both set a terminal status + ended_at), kept as two distinct
// endpoints/actions because they carry different administrative meaning,
// exactly mirroring trial.functions.ts's own adminEndTrial/adminRevokeTrial
// split.
import { writeAuditLog } from "@/lib/admin.server";
import { ApiError } from "@/lib/v1/http.server";

export async function setTrialStatus(
  trialId: string,
  status: "ended" | "revoked",
  adminUserId: string,
  reason?: string | null,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: previous } = await supabaseAdmin
    .from("promotional_trials")
    .select("*")
    .eq("id", trialId)
    .maybeSingle();
  if (!previous) throw new ApiError("NOT_FOUND", "Trial not found");
  if (previous.status !== "active")
    throw new ApiError("CONFLICT", "This trial is not currently active");

  const { data: row, error } = await supabaseAdmin
    .from("promotional_trials")
    .update({ status, ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", trialId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  await writeAuditLog({
    userId: adminUserId,
    action: status === "ended" ? "promotional_trial.end" : "promotional_trial.revoke",
    entityType: "promotional_trial",
    entityId: trialId,
    oldData: previous,
    newData: row,
    reason: reason ?? null,
  });
  return row;
}
