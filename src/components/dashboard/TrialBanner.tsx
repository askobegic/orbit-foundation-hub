import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Sparkles, AlertTriangle } from "lucide-react";

import { getMyActiveTrial } from "@/lib/trial.functions";

/**
 * Shows either an active-Promotional-Trial banner or an expired-trial
 * banner. Returns null for a user who has never had a trial. Priority
 * 8.5: Trial is never auto-activated -- this component only ever reads
 * (getMyActiveTrial), it never grants one.
 */
export function TrialBanner() {
  const { t, i18n } = useTranslation();
  const getMyActiveTrialFn = useServerFn(getMyActiveTrial);

  const trialQuery = useQuery({
    queryKey: ["dashboard", "my-active-trial"],
    queryFn: () => getMyActiveTrialFn(),
  });

  const trial = trialQuery.data;
  if (!trial) return null;

  const isActive = trial.status === "active" && new Date(trial.expires_at).getTime() > Date.now();

  if (isActive) {
    const date = new Date(trial.expires_at).toLocaleDateString(i18n.language);
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

  const endedDate = new Date(trial.ended_at ?? trial.expires_at).toLocaleDateString(i18n.language);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">{t("trial.expiredTitle")}</p>
          <p className="text-xs opacity-80">
            {t("trial.expiredHint")} ({endedDate})
          </p>
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
