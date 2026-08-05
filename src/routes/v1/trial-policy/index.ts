// API_CONTRACT.md §11 -- GET /v1/trial-policy. Reuses getTrialPolicy()
// directly (public, middleware-less).
import { createFileRoute } from "@tanstack/react-router";

import { getTrialPolicy } from "@/lib/trial.functions";
import { apiData, withRoute } from "@/lib/v1/http.server";

export const Route = createFileRoute("/v1/trial-policy/")({
  server: {
    handlers: {
      GET: withRoute(async () => {
        const policy = await getTrialPolicy();
        return apiData(policy);
      }),
    },
  },
});
