import { useLanguage } from "@/context/LanguageContext";
import type { SupportedLanguage } from "@/lib/i18n";

const LABELS: Record<SupportedLanguage, string> = { bs: "BS", en: "EN", de: "DE" };

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { language, setLanguage, supported } = useLanguage();
  return (
    <div className={`flex justify-center gap-2 ${className}`.trim()}>
      {supported.map((lang) => {
        const active = lang === language;
        return (
          <button
            key={lang}
            type="button"
            onClick={() => void setLanguage(lang)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? "border-transparent bg-[#1D6BF3] text-white"
                : "border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-gray-50"
            }`}
            aria-pressed={active}
          >
            {LABELS[lang]}
          </button>
        );
      })}
    </div>
  );
}