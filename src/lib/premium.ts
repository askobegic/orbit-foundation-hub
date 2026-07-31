// CORE Premium Service -- the single, shared place Premium status is ever
// checked from. Components must call these functions instead of issuing
// their own ad hoc supabase.rpc()/subscriptions queries, so every surface
// answers "is this user premium" the same way. See PROJECT_KNOWLEDGE.md ->
// Premium Model.
//
// Global Premium Visibility & Contact System: Premium is ecosystem-wide --
// there is no per-application Premium check. The one-time, per-app-scoped
// isUserPremium(userId, appId) has been removed (zero call sites; see the
// migration dropping its backing SQL function).
import { supabase } from "@/integrations/supabase/client";
import type { ApplicationRow } from "@/types/database";

// TRUE if the user holds an active Premium subscription on ANY CORE
// application. This is the ONE "is this user Premium" check -- every
// surface (Profile Card tier, contact eligibility, dashboard badges,
// editable-field gating) must call this, never re-derive it inline.
export async function hasAnyActivePremium(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_any_active_premium", { _user_id: userId });
  if (error) {
    console.error("hasAnyActivePremium failed", error);
    return false;
  }
  return !!data;
}

// The applications where the user currently has a visible public profile
// (user_app_settings.is_visible = true), in applications.sort_order --
// backs the Profile Card's "Public profile on" section. This is a
// presence list, not a Premium-purchase list: under global Premium there
// is no per-application "where did I buy Premium" concept left to show.
export async function getVisibleApplications(userId: string): Promise<ApplicationRow[]> {
  const { data: appIds, error } = await supabase.rpc("get_visible_application_ids", {
    _user_id: userId,
  });
  if (error) {
    console.error("getVisibleApplications failed", error);
    return [];
  }
  const ids = appIds ?? [];
  if (ids.length === 0) return [];

  const { data: apps, error: appsError } = await supabase
    .from("applications")
    .select("*")
    .in("id", ids)
    .order("sort_order", { ascending: true });
  if (appsError) {
    console.error("getVisibleApplications: applications fetch failed", appsError);
    return [];
  }
  // The DB schema allows primary_color/secondary_color to be NULL (no NOT
  // NULL constraint, just a DEFAULT) while ApplicationRow declares them
  // required -- a pre-existing, unrelated type-accuracy gap this cast
  // already covered before today's types.ts regeneration made it visible.
  return (apps ?? []) as unknown as ApplicationRow[];
}
