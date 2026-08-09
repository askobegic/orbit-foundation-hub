// API_CONTRACT.md §18 -- POST /v1/media/advertising-banner. Same
// bucket/path/validation as dashboard.advertising.tsx's client-side upload
// (campaignBannerPath, media-storage.ts) -- uploaded here via
// supabaseAdmin.storage since the caller authenticates via the CORE JWT.
// A new URL per upload (banners aren't replaced in place, matching today's
// timestamped-filename behavior).
import { createFileRoute } from "@tanstack/react-router";

import { campaignBannerPath } from "@/lib/media-storage";
import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireUserContext, resolveAppId } from "@/lib/v1/context.server";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 5 * 1024 * 1024;

export const Route = createFileRoute("/v1/media/advertising-banner")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const ctx = await requireUserContext(request);
        const url = new URL(request.url);
        const appId = await resolveAppId(request, url, { required: true });

        const capabilities = await getApplicationCapabilities({ data: { appId: appId! } });
        if (!capabilities.includes("advertising")) {
          throw new ApiError(
            "CAPABILITY_DISABLED",
            "Advertising is not enabled for this application.",
          );
        }

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

        const path = campaignBannerPath(ctx.userId, file.type);
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
