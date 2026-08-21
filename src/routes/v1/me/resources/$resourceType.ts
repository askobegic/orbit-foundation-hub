// API_CONTRACT.md §9 -- PUT /v1/me/resources/{resourceType}. The one write
// path a connected application uses to tell CORE's central Dashboard that
// the calling user owns a resource in that application's own database (a
// Shop, a Business, an Event...) -- CORE stores only this generic
// reference/status, never the underlying business data (spec section 9).
// Scoped to the caller's own verified identity and application (`sub`/
// `azp`) exactly like POST /v1/events -- never trusts a body-supplied
// userId/appId.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { isSafeDashboardDestination } from "@/lib/dashboard-actions.functions";
import { ApiError, apiData, parseBody, readJsonBody, withRoute } from "@/lib/v1/http.server";
import { requireUserContext } from "@/lib/v1/context.server";

const bodySchema = z.object({
  label: z.string().trim().min(1).max(200),
  status: z.enum(["active", "pending", "incomplete", "inactive"]).default("active"),
  destination: z.string().trim().max(2000).nullable().optional(),
});

export const Route = createFileRoute("/v1/me/resources/$resourceType")({
  server: {
    handlers: {
      PUT: withRoute(async ({ request, params }) => {
        const ctx = await requireUserContext(request);
        const data = parseBody(bodySchema, await readJsonBody(request));
        const resourceType = params.resourceType.trim().slice(0, 60);
        if (!resourceType) {
          throw new ApiError("VALIDATION_ERROR", "resourceType is required", [
            { field: "resourceType", issue: "required" },
          ]);
        }
        if (data.destination && !isSafeDashboardDestination(data.destination)) {
          throw new ApiError(
            "VALIDATION_ERROR",
            "destination must be an internal path or an http(s) URL",
            [{ field: "destination", issue: "unsafe_scheme" }],
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("resource_references")
          .upsert(
            {
              user_id: ctx.userId,
              app_id: ctx.appId,
              resource_type: resourceType,
              label: data.label,
              status: data.status,
              destination: data.destination ?? null,
            },
            { onConflict: "user_id,app_id,resource_type" },
          )
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        return apiData({
          resourceType: row.resource_type,
          label: row.label,
          status: row.status,
          destination: row.destination,
        });
      }),
    },
  },
});
