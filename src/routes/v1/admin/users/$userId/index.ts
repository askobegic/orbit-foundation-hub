// API_CONTRACT.md §19 -- PATCH/DELETE /v1/admin/users/{userId}. Replicates
// adminUpdateUser/adminDeleteUser (admin.functions.ts) since both are
// requireSupabaseAuth-middleware server functions; deleteUserAccountCascade
// (plain function, admin.server.ts) reused directly -- shares its
// implementation with DELETE /v1/me, never a duplicated deletion path.
// PATCH deliberately excludes firstName/lastName/avatarUrl (Identity Lock)
// and email, matching PATCH /v1/me's own restrictions exactly.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { deleteUserAccountCascade, writeAuditLog } from "@/lib/admin.server";
import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";
import type { Database } from "@/integrations/supabase/types";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

const patchSchema = z.object({
  city: z.string().trim().min(1).nullable().optional(),
  country: z.string().trim().min(1).nullable().optional(),
  bio: z.string().nullable().optional(),
  username: z.string().trim().min(1).nullable().optional(),
});

export const Route = createFileRoute("/v1/admin/users/$userId/")({
  server: {
    handlers: {
      PATCH: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        const data = parseBody(patchSchema, await readJsonBody(request));

        const patch: ProfileUpdate = {};
        if (data.city !== undefined) patch.city = data.city;
        if (data.country !== undefined) patch.country = data.country;
        if (data.bio !== undefined) patch.bio = data.bio;
        if (data.username !== undefined) patch.username = data.username;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("profiles")
          .update(patch)
          .eq("id", params.userId)
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await writeAuditLog({
          userId: admin.userId,
          action: "user.update",
          entityType: "profile",
          entityId: params.userId,
          newData: patch,
        });

        return apiData({
          id: row.id,
          city: row.city,
          country: row.country,
          bio: row.bio,
          username: row.username,
        });
      }),

      DELETE: withRoute(async ({ request, params }) => {
        const admin = await requireAdminContext(request);
        if (params.userId === admin.userId) {
          throw new ApiError("FORBIDDEN", "Use DELETE /v1/me to delete your own account.");
        }
        await deleteUserAccountCascade({
          targetUserId: params.userId,
          actorUserId: admin.userId,
          action: "user.delete",
        });
        return apiData({ ok: true });
      }),
    },
  },
});
