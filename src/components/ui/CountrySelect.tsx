import { useTranslation } from "react-i18next";

export const COUNTRY_CODES = [
  "BA", "HR", "RS", "SI", "MK", "ME", "DE", "AT", "CH", "US", "AU", "other",
] as const;

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  id?: string;
}

export function CountrySelect({ value, onChange, className, id }: Props) {
  const { t } = useTranslation();
  return (
    <select
      id={id}
      value={value || "BA"}
      onChange={(e) => onChange(e.target.value)}
      className={
        className ??
        "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D6BF3]"
      }
    >
      {COUNTRY_CODES.map((c) => (
        <option key={c} value={c}>
          {t(`countries.${c}`)}
        </option>
      ))}
    </select>
  );
}