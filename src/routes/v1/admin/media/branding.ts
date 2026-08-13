// API_CONTRACT.md §18 -- POST /v1/admin/media/branding. Tier 1 content
// (logo/favicon/cover) -- admin-only, same bucket/path/validation as
// admin.applications.tsx's client-side upload, never routed through the
// Tier-2 MediaStorageProvider adapter (PROJECT_KNOWLEDGE.md -> Media
// Strategy).
import { createFileRoute } from "@tanstack/react-router";

import { BRANDING_ALLOWED_TYPES, brandingMaxSize, writeAuditLog, writeBrandingAsset } from "@/lib/admin.server";
import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

const PURPOSES = ["logo", "favicon", "cover"] as const;

export const Route = createFileRoute("/v1/admin/media/branding")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        const { userId } = await requireAdminContext(request);

        const form = await request.formData();
        const file = form.get("file");
        const purposeRaw = form.get("purpose");
        const appId = form.get("appId");

        if (!(file instanceof File)) {
          throw new ApiError("VALIDATION_ERROR", "file is required.", [
            { field: "file", issue: "required" },
          ]);
        }
        if (
          typeof purposeRaw !== "string" ||
          !PURPOSES.includes(purposeRaw as (typeof PURPOSES)[number])
        ) {
          throw new ApiError("VALIDATION_ERROR", "purpose must be logo, favicon, or cover.", [
            { field: "purpose", issue: "invalid" },
          ]);
        }
        const purpose = purposeRaw as (typeof PURPOSES)[number];
        if (typeof appId !== "string" || !appId) {
          throw new ApiError("VALIDATION_ERROR", "appId is required.", [
            { field: "appId", issue: "required" },
          ]);
        }
        if (!BRANDING_ALLOWED_TYPES[file.type]) {
          throw new ApiError("VALIDATION_ERROR", "Unsupported file type.", [
            { field: "file", issue: "unsupported_type" },
          ]);
        }
        if (file.size > brandingMaxSize(purpose)) {
          throw new ApiError("VALIDATION_ERROR", "File is too large.", [
            { field: "file", issue: "too_large" },
          ]);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: app } = await supabaseAdmin
          .from("applications")
          .select("slug")
          .eq("id", appId)
          .maybeSingle();
        if (!app) throw new ApiError("NOT_FOUND", "Application not found.");

        const { url } = await writeBrandingAsset({ appSlug: app.slug, purpose, file });

        await writeAuditLog({
          userId,
          action: "application.branding_uploaded",
          entityType: "application",
          entityId: appId,
          newData: { purpose, url },
        });

        return apiData({ url });
      }),
    },
  },
});
