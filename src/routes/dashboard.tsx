import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useAuth } from "@/context/AuthContext";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Core Platform" },
      { name: "description", content: "Vaš kontrolni centar na Core Platformi." },
      { property: "og:title", content: "Dashboard — Core Platform" },
      { property: "og:description", content: "Vaš kontrolni centar na Core Platformi." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <DashboardPage />
    </ProtectedRoute>
  ),
});

function DashboardPage() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {t("dashboard.welcome")}, {profile?.first_name}
            </h1>
            <p className="text-sm text-gray-500">{t("dashboard.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t("nav.logout")}
            </button>
          </div>
        </header>
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-600">{t("dashboard.myApps")} — {t("dashboard.comingSoon")}</p>
        </section>
      </div>
    </main>
  );
}