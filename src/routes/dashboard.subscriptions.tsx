import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Crown } from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { effectiveSubscriptionStatus } from "@/lib/subscription";
import type {
  ApplicationRow,
  SubscriptionPlanRow,
  SubscriptionRow,
} from "@/types/database";

export const Route = createFileRoute("/dashboard/subscriptions")({
  head: () => ({
    meta: [
      { title: "My Subscriptions — Core Platform" },
      { name: "description", content: "Manage your Premium subscriptions." },
      { property: "og:title", content: "My Subscriptions — Core Platform" },
      { property: "og:description", content: "Manage your Premium subscriptions." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <SubsPage />
    </ProtectedRoute>
  ),
});

type Row = SubscriptionRow & {
  plan: SubscriptionPlanRow | null;
  app: ApplicationRow | null;
};

function SubsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const q = useQuery({
    queryKey: ["my-subs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*, plan:subscription_plans(*), app:applications(*)")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <Link
          to="/dashboard"
          className="mb-6 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("auth.backToDashboard")}
        </Link>
        <h1 className="mb-6 text-2xl font-semibold text-gray-900">
          {t("subscription.title")}
        </h1>
        {q.isLoading ? (
          <p className="text-sm text-gray-500">{t("pricing.loading")}</p>
        ) : (q.data?.length ?? 0) === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-100">
            <p className="text-sm text-gray-600">{t("dashboard.noSubscription")}</p>
            <Link
              to="/pricing"
              className="mt-4 inline-block rounded-lg bg-[#1D6BF3] px-4 py-2 text-sm font-medium text-white"
            >
              {t("dashboard.upgrade")}
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {q.data!.map((s) => {
              const status = effectiveSubscriptionStatus(s);
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-semibold text-white"
                      style={{ backgroundColor: s.app?.primary_color ?? "#1D6BF3" }}
                    >
                      <Crown className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {s.app?.name ?? t("dashboard.premium")} · {s.plan?.name ?? ""}
                      </p>
                      <p className="text-xs text-gray-500">
                        {t("dashboard.validUntil")}:{" "}
                        {new Date(s.expires_at).toLocaleDateString(i18n.language)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      status === "active"
                        ? "bg-emerald-100 text-emerald-700"
                        : status === "pending"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {t(`subscription.status.${status}`)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}