import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Sparkles, AlertTriangle } from "lucide-react";

import type { SubscriptionRow } from "@/types/database";

/**
 * Shows either an active-trial banner or an expired-trial banner.
 * Returns null when the user is on a paid plan or has never had a trial.
 */
export function TrialBanner({ subscriptions }: { subscriptions: SubscriptionRow[] }) {
  const { t, i18n } = useTranslation();

  const state = useMemo(() => {
    const trials = subscriptions.filter((s) => s.stripe_payment_id === "trial_7days");
    const paid = subscriptions.some(
      (s) =>
        s.stripe_payment_id !== "trial_7days" &&
        s.status === "active" &&
        new Date(s.expires_at).getTime() > Date.now(),
    );
    if (paid) return { kind: "hidden" as const };
    if (trials.length === 0) return { kind: "hidden" as const };

    const now = Date.now();
    const active = trials.find(
      (s) => s.status === "active" && new Date(s.expires_at).getTime() > now,
    );
    if (active) return { kind: "active" as const, expires_at: active.expires_at };
    // most recent trial
    const latest = [...trials].sort(
      (a, b) => new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime(),
    )[0];
    return { kind: "expired" as const, expires_at: latest.expires_at };
  }, [subscriptions]);

  if (state.kind === "hidden") return null;

  if (state.kind === "active") {
    const date = new Date(state.expires_at).toLocaleDateString(i18n.language);
    return (
      <section className="flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-[#F59E0B] to-[#EF4444] p-4 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">{t("trial.activeTitle")}</p>
            <p className="text-xs opacity-90">
              {t("trial.activeExpires")}: {date}
            </p>
          </div>
        </div>
        <Link
          to="/pricing"
          className="inline-flex items-center justify-center rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#EF4444] hover:bg-white/90"
        >
          {t("dashboard.upgrade")}
        </Link>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">{t("trial.expiredTitle")}</p>
          <p className="text-xs opacity-80">{t("trial.expiredHint")}</p>
        </div>
      </div>
      <Link
        to="/pricing"
        className="inline-flex items-center justify-center rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
      >
        {t("trial.upgradeNow")}
      </Link>
    </section>
  );
}