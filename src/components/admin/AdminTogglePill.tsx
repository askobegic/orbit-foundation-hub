import { useTranslation } from "react-i18next";

export interface AdminTogglePillProps {
  enabled: boolean;
  onClick: () => void;
  disabled?: boolean;
}

// Shared Enabled/Disabled toggle used across the admin registries
// (Capabilities, Dashboard Widgets, Rewards, Advertising) -- previously the
// exact same button was duplicated in each of those pages. One shared
// definition also means the touch-target size only needs fixing once.
export function AdminTogglePill({ enabled, onClick, disabled }: AdminTogglePillProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
        enabled ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"
      }`}
    >
      {enabled ? t("admin.common.enabled") : t("admin.common.disabled")}
    </button>
  );
}
