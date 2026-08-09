// API_CONTRACT.md §18 -- POST /v1/admin/media/branding. Tier 1 content
// (logo/favicon/cover) -- admin-only, same bucket/path/validation as
// admin.applications.tsx's client-side upload, never routed through the
// Tier-2 MediaStorageProvider adapter (PROJECT_KNOWLEDGE.md -> Media
// Strategy).
import { createFileRoute } from "@tanstack/react-router";

import { ApiError, apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

// image/svg+xml deliberately excluded -- SVG is an active-content format
// (can embed <script>) and these files are served publicly from the
// storage domain; accepting it here would be a stored-XSS vector
// (Priority 11 security audit).
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
];
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};
const PURPOSES = ["logo", "favicon", "cover"] as const;

export const Route = createFileRoute("/v1/admin/media/branding")({
  server: {
    handlers: {
      POST: withRoute(async ({ request }) => {
        await requireAdminContext(request);

        const form = await request.formData();
        const file = form.get("file");
        const purpose = form.get("purpose");
        const appId = form.get("appId");

        if (!(file instanceof File)) {
          throw new ApiError("VALIDATION_ERROR", "file is required.", [
            { field: "file", issue: "required" },
          ]);
        }
        if (
          typeof purpose !== "string" ||
          !PURPOSES.includes(purpose as (typeof PURPOSES)[number])
        ) {
          throw new ApiError("VALIDATION_ERROR", "purpose must be logo, favicon, or cover.", [
            { field: "purpose", issue: "invalid" },
          ]);
        }
        if (typeof appId !== "string" || !appId) {
          throw new ApiError("VALIDATION_ERROR", "appId is required.", [
            { field: "appId", issue: "required" },
          ]);
        }
        if (!ALLOWED_TYPES.includes(file.type)) {
          throw new ApiError("VALIDATION_ERROR", "Unsupported file type.", [
            { field: "file", issue: "unsupported_type" },
          ]);
        }
        const maxSize = purpose === "cover" ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
        if (file.size > maxSize) {
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

        // Extension is derived from the validated file.type, never from the
        // client-supplied filename -- a filename can carry an arbitrary
        // trailing path segment that would otherwise become part of the
        // storage object key (Priority 11 security audit).
        const ext = EXTENSION_BY_TYPE[file.type] ?? "png";
        const path = `applications/${app.slug}/${purpose}.${ext}`;
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
