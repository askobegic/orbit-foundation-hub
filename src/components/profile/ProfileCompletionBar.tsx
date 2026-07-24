import { useTranslation } from "react-i18next";
import type { ProfileRow } from "@/types/database";

interface Props {
  profile: ProfileRow | null;
}

export function ProfileCompletionBar({ profile }: Props) {
  const { t } = useTranslation();
  if (!profile) return null;
  const checks: { key: string; ok: boolean }[] = [
    { key: t("profile.firstName"), ok: !!profile.first_name },
    { key: t("profile.lastName"), ok: !!profile.last_name },
    { key: t("profile.city"), ok: !!profile.city },
    { key: t("profile.country"), ok: !!profile.country },
    { key: t("profile.bio"), ok: !!profile.bio },
    { key: t("profile.uploadPhoto"), ok: !!profile.avatar_url },
  ];
  const done = checks.filter((c) => c.ok).length;
  const pct = Math.round((done / checks.length) * 100);
  const missing = checks.filter((c) => !c.ok).map((c) => c.key);

  if (profile.profile_complete && pct === 100) return null;

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-orange-900">{t("profile.completeProfile")}</h3>
        <span className="text-xs font-medium text-orange-800">{pct}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-orange-100">
        <div
          className="h-full rounded-full bg-orange-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-orange-800">
          {t("profile.profileCompletion")}: {missing.join(", ")}
        </p>
      )}
    </div>
  );
}