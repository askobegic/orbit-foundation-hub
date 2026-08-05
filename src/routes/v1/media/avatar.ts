// API_CONTRACT.md §18 -- POST /v1/media/avatar. Same bucket/path/validation
// as AvatarUpload.tsx's client-side upload (avatarPath, media-storage.ts) --
// uploaded here via supabaseAdmin.storage since the caller authenticates
// via the CORE JWT, not a Supabase browser session (media-storage.ts's
// SupabaseCoreBucketProvider is bound to the anon client and stays
// client-only). Re-uploading replaces the existing file at the same path,
// matching today's fixed-filename behavior.
import { createFileRoute } from "@tanstack/react-router";

import { avatarPath } from "@/lib/media-storage";
import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024;

export const Route = createFileRoute("/v1/media/avatar")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          throw new ApiError("VALIDATION_ERROR", "file is required.", [
            { field: "file", issue: "required" },
          ]);
        }
        if (!ALLOWED_TYPES.includes(file.type)) {
          throw new ApiError("VALIDATION_ERROR", "Unsupported file type.", [
            { field: "file", issue: "unsupported_type" },
          ]);
        }
        if (file.size > MAX_SIZE) {
          throw new ApiError("VALIDATION_ERROR", "File is too large (max 5MB).", [
            { field: "file", issue: "too_large" },
          ]);
        }

        const path = avatarPath(ctx.userId, file.name);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.storage.from("core").upload(path, file, {
          upsert: true,
          contentType: file.type,
        });
        if (error) throw new Error(error.message);

        const {
          data: { publicUrl },
        } = supabaseAdmin.storage.from("core").getPublicUrl(path);

        return apiData({ url: publicUrl });
      }),
    },
  },
});
