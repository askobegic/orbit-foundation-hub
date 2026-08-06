import { useEffect, useState } from "react";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2 } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/payment/success")({
  head: () => ({
    meta: [
      { title: "Payment success — Core Platform" },
      { name: "description", content: "Your Premium subscription is being activated." },
      { property: "og:title", content: "Payment success — Core Platform" },
      { property: "og:description", content: "Your Premium subscription is being activated." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    session_id: typeof s.session_id === "string" ? s.session_id : undefined,
    app_id: typeof s.app_id === "string" ? s.app_id : undefined,
  }),
  component: SuccessPage,
});

function SuccessPage() {
  const { t } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const search = useSearch({ from: "/payment/success" });
  const [attempts, setAttempts] = useState(0);

  const subQuery = useQuery({
    queryKey: ["payment-success", user?.id, attempts],
    enabled: !!user,
    refetchInterval: 3000,
    queryFn: async () => {
      let q = supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user!.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1);
      if (search.app_id) q = q.eq("app_id", search.app_id);
      const { data } = await q;
      return data?.[0] ?? null;
    },
  });

  useEffect(() => {
    const id = setInterval(() => setAttempts((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (subQuery.data) void refreshProfile();
  }, [subQuery.data, refreshProfile]);

  const activated = !!subQuery.data;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-100 sm:p-8">
        {activated ? (
          <>
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
            <h1 className="mt-4 text-2xl font-semibold text-gray-900">
              {t("payment.successTitle")}
            </h1>
            <p className="mt-2 text-sm text-gray-600">{t("payment.successBody")}</p>
            <Link
              to="/dashboard"
              className="mt-6 inline-block rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white hover:bg-[#1858cf]"
            >
              {t("auth.backToDashboard")}
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-[#1D6BF3]" />
            <h1 className="mt-4 text-xl font-semibold text-gray-900">
              {t("payment.activating")}
            </h1>
            <p className="mt-2 text-sm text-gray-600">{t("payment.activatingBody")}</p>
            {search.session_id && (
              <p className="mt-3 text-[10px] uppercase text-gray-400">
                Ref: {search.session_id.slice(0, 20)}…
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}