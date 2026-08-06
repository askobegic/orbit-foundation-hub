import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  max?: number;
  disabled?: boolean;
}

export function ProfessionTagInput({ value, onChange, max = 3, disabled }: Props) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");

  function add() {
    const v = input.trim();
    if (!v || value.includes(v) || value.length >= max) return;
    onChange([...value, v]);
    setInput("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== tag))}
                className="-mr-1 flex h-5 w-5 items-center justify-center rounded-full text-blue-500 hover:bg-blue-100 hover:text-blue-700"
                aria-label="Remove"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          disabled={disabled || value.length >= max}
          placeholder={t("profile.professionPlaceholder")}
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D6BF3] focus-visible:ring-2 focus-visible:ring-[#1D6BF3]/40 disabled:bg-gray-50"
        />
        <button
          type="button"
          onClick={add}
          disabled={disabled || value.length >= max || !input.trim()}
          className="rounded-lg bg-[#1D6BF3] px-3 py-2.5 text-sm font-medium text-white hover:bg-[#155ac9] disabled:opacity-60"
        >
          {t("profile.addProfession")}
        </button>
      </div>
      <span className="text-xs text-gray-500">{value.length}/{max}</span>
    </div>
  );
}