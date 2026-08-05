// API_CONTRACT.md §6 -- GET /v1/me, PATCH /v1/me, DELETE /v1/me.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { deleteUserAccountCascade } from "@/lib/admin.server";
import { apiData, ApiError, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";
import type { Database } from "@/integrations/supabase/types";
import type { ProfileRow } from "@/types/database";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

function toProfile(row: ProfileRow) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    avatarUrl: row.avatar_url,
    username: row.username,
    city: row.city,
    country: row.country,
    bio: row.bio,
    language: row.language,
    isVerified: row.is_verified,
    isActive: row.is_active,
    profileComplete: row.profile_complete,
    identityLocked: !!row.identity_locked_at,
    notifyEmail: row.notify_email,
    notifyInApp: row.notify_in_app,
    notifyMarketing: row.notify_marketing,
    createdAt: row.created_at,
  };
}

// email is deliberately never accepted -- it always resyncs from the auth
// identity (PROJECT_KNOWLEDGE.md -> Identity Lock), never a client-supplied
// value. firstName/lastName/avatarUrl are accepted only until Identity Lock
// engages, checked below, not in this schema (the schema alone can't know
// the caller's current lock state).
const patchSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  avatarUrl: z.string().url().optional(),
  city: z.string().trim().min(1).nullable().optional(),
  country: z.string().trim().min(1).nullable().optional(),
  bio: z.string().nullable().optional(),
  username: z.string().trim().min(1).nullable().optional(),
  language: z.enum(["bs", "en", "de"]).optional(),
  notifyEmail: z.boolean().optional(),
  notifyInApp: z.boolean().optional(),
  notifyMarketing: z.boolean().optional(),
});

export const Route = createFileRoute("/v1/me/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("profiles")
          .select("*")
          .eq("id", ctx.userId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new ApiError("NOT_FOUND", "Profile not found");
        return apiData(toProfile(data as ProfileRow));
      }),

      PATCH: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: existing, error: fetchErr } = await supabaseAdmin
          .from("profiles")
          .select("first_name, last_name, avatar_url, identity_locked_at")
          .eq("id", ctx.userId)
          .maybeSingle();
        if (fetchErr) throw new Error(fetchErr.message);
        if (!existing) throw new ApiError("NOT_FOUND", "Profile not found");

        const identityLocked = !!existing.identity_locked_at;
        if (
          identityLocked &&
          (data.firstName !== undefined ||
            data.lastName !== undefined ||
            data.avatarUrl !== undefined)
        ) {
          throw new ApiError(
            "VALIDATION_ERROR",
            "Identity is locked -- firstName/lastName/avatarUrl can no longer be changed",
            [
              ...(data.firstName !== undefined
                ? [{ field: "firstName", issue: "identity_locked" }]
                : []),
              ...(data.lastName !== undefined
                ? [{ field: "lastName", issue: "identity_locked" }]
                : []),
              ...(data.avatarUrl !== undefined
                ? [{ field: "avatarUrl", issue: "identity_locked" }]
                : []),
            ],
          );
        }

        const patch: ProfileUpdate = {};
        if (data.firstName !== undefined) patch.first_name = data.firstName;
        if (data.lastName !== undefined) patch.last_name = data.lastName;
        if (data.avatarUrl !== undefined) patch.avatar_url = data.avatarUrl;
        if (data.city !== undefined) patch.city = data.city;
        if (data.country !== undefined) patch.country = data.country;
        if (data.bio !== undefined) patch.bio = data.bio;
        if (data.username !== undefined) patch.username = data.username;
        if (data.language !== undefined) patch.language = data.language;
        if (data.notifyEmail !== undefined) patch.notify_email = data.notifyEmail;
        if (data.notifyInApp !== undefined) patch.notify_in_app = data.notifyInApp;
        if (data.notifyMarketing !== undefined) patch.notify_marketing = data.notifyMarketing;

        const { data: updated, error } = await supabaseAdmin
          .from("profiles")
          .update(patch)
          .eq("id", ctx.userId)
          .select("*")
          .single();
        if (error) throw new Error(error.message);
        return apiData(toProfile(updated as ProfileRow));
      }),

      DELETE: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        await deleteUserAccountCascade({
          targetUserId: ctx.userId,
          actorUserId: ctx.userId,
          action: "account_deleted",
        });
        return apiData({ ok: true });
      }),
    },
  },
});
