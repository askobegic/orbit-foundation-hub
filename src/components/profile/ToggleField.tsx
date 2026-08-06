import { useTranslation } from "react-i18next";

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isPublic: boolean;
  onToggle: (v: boolean) => void;
  type?: "text" | "email" | "tel" | "url";
  placeholder?: string;
  disabled?: boolean;
}

export function ToggleField({
  label,
  value,
  onChange,
  isPublic,
  onToggle,
  type = "text",
  placeholder,
  disabled,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onToggle(!isPublic)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
            isPublic
              ? "bg-green-100 text-green-700"
              : "bg-gray-100 text-gray-600"
          } disabled:opacity-60`}
        >
          {isPublic ? t("profile.public") : t("profile.private")}
        </button>
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D6BF3] focus-visible:ring-2 focus-visible:ring-[#1D6BF3]/40 disabled:bg-gray-50"
      />
    </div>
  );
}