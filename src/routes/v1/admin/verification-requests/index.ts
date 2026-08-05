// API_CONTRACT.md §19 -- GET /v1/admin/verification-requests. Replicates
// adminListVerificationRequests (admin.functions.ts) since it's a
// requireSupabaseAuth-middleware server function; resolvePremiumStatusBulk
// (plain function) reused directly so a Trial-only Premium user is a
// candidate too.
import { createFileRoute } from "@tanstack/react-router";

import { resolvePremiumStatusBulk } from "@/lib/premium.server";
import { apiData, withRoute } from "@/lib/v1/http.server";
import { requireAdminContext } from "@/lib/v1/context.server";

export const Route = createFileRoute("/v1/admin/verification-requests/")({
  server: {
    handlers: {
      GET: withRoute(async ({ request }) => {
        await requireAdminContext(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const ids = [...(await resolvePremiumStatusBulk(supabaseAdmin)).keys()];
        if (ids.length === 0) return apiData([]);

        const { data, error } = await supabaseAdmin
          .from("profiles")
          .select(
            "id, email, first_name, last_name, username, avatar_url, city, country, is_verified, created_at",
          )
          .in("id", ids)
          .order("is_verified", { ascending: true })
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);

        return apiData(
          (data ?? []).map((r) => ({
            id: r.id,
            email: r.email,
            firstName: r.first_name,
            lastName: r.last_name,
            username: r.username,
            avatarUrl: r.avatar_url,
            city: r.city,
            country: r.country,
            isVerified: r.is_verified,
            createdAt: r.created_at,
          })),
        );
      }),
    },
  },
});
