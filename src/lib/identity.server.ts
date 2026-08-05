// Priority 8.11: server-side counterpart to AuthContext.tsx's
// `loadOrCreateProfile` -- needed because the /v1 API's session endpoint
// (an external application's own backend, not this app's browser session)
// has no client-side AuthContext to run. Reuses the exact same identity
// extraction (`extractIdentityFromAuthUser`, src/lib/identity.ts) and the
// exact same fill-once-for-name/avatar, always-resync-for-email rules
// (PROJECT_KNOWLEDGE.md -> Identity Lock) -- this is the first server-side
// implementation of that persistence logic, not a duplicate of one that
// already existed server-side.
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { extractIdentityFromAuthUser } from "@/lib/identity";
import type { ProfileRow, ProfileUpdate } from "@/types/database";

export async function ensureProfile(
  supabaseAdmin: SupabaseClient,
  user: User,
): Promise<{ profile: ProfileRow; isNewUser: boolean }> {
  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) {
    const identity = extractIdentityFromAuthUser(user);
    const patch: ProfileUpdate = {};
    if (!existing.first_name) patch.first_name = identity.firstName;
    if (!existing.last_name) patch.last_name = identity.lastName;
    if (!existing.avatar_url) patch.avatar_url = identity.avatarUrl;
    if (user.email && existing.email !== user.email) patch.email = user.email;

    if (Object.keys(patch).length > 0) {
      const { data: updated, error } = await supabaseAdmin
        .from("profiles")
        .update(patch)
        .eq("id", user.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { profile: updated as ProfileRow, isNewUser: false };
    }
    return { profile: existing as ProfileRow, isNewUser: false };
  }

  const identity = extractIdentityFromAuthUser(user);
  const { data: created, error } = await supabaseAdmin
    .from("profiles")
    .insert({
      id: user.id,
      email: user.email ?? "",
      first_name: identity.firstName,
      last_name: identity.lastName,
      avatar_url: identity.avatarUrl,
      profile_complete: false,
      language: "bs",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return { profile: created as ProfileRow, isNewUser: true };
}
