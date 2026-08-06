import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Shield, LogOut, Clock } from "lucide-react";
import { toast } from "sonner";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardMobileNav } from "@/components/dashboard/DashboardNav";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/dashboard/security")({
  head: () => ({
    meta: [
      { title: "Sigurnost — Core Platform" },
      { name: "description", content: "Pregled sigurnosti vašeg naloga." },
      { property: "og:title", content: "Sigurnost — Core Platform" },
      { property: "og:description", content: "Pregled sigurnosti vašeg naloga." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <SecurityPage />
    </ProtectedRoute>
  ),
});

function SecurityPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const lastSignIn = user?.last_sign_in_at ? new Date(user.last_sign_in_at) : null;
  const created = user?.created_at ? new Date(user.created_at) : null;

  async function signOutAll() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) throw error;
      toast.success(t("security.signedOutAll"));
      window.location.href = "/login";
    } catch (e) {
      toast.error(t("common.errorGeneric"));
      setBusy(false);
    }
  }

  const history = lastSignIn
    ? [{ at: lastSignIn, label: t("security.currentSession") }]
    : [];

  return (
    <main className="min-h-screen bg-[#F7F8FA] px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("auth.backToDashboard")}
        </Link>

        <header className="mt-4 flex items-center gap-3">
          <DashboardMobileNav />
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1D6BF3]/10 text-[#1D6BF3]">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t("security.title")}</h1>
            <p className="text-sm text-gray-500">{t("security.subtitle")}</p>
          </div>
        </header>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">
            {t("security.lastLogin")}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {lastSignIn
              ? lastSignIn.toLocaleString(i18n.language)
              : t("security.notAvailable")}
          </p>
          {created && (
            <p className="mt-3 text-xs text-gray-500">
              {t("security.accountCreated")}: {created.toLocaleString(i18n.language)}
            </p>
          )}
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">
            {t("security.loginHistory")}
          </h2>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">{t("security.noHistory")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {history.map((h, i) => (
                <li key={i} className="flex items-center gap-3 py-3 text-sm">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">{h.label}</p>
                    <p className="text-xs text-gray-500">
                      {h.at.toLocaleString(i18n.language)}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    {t("security.active")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-gray-400">{t("security.historyHint")}</p>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">
            {t("security.signOutAllTitle")}
          </h2>
          <p className="mt-1 text-sm text-gray-600">{t("security.signOutAllHint")}</p>
          <button
            type="button"
            onClick={signOutAll}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" />
            {busy ? t("common.saving") : t("security.signOutAll")}
          </button>
        </section>
      </div>
    </main>
  );
}