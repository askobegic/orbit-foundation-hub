import { useTranslation } from "react-i18next";

export interface SocialLinks {
  facebook_url: string;
  instagram_url: string;
  tiktok_url: string;
  youtube_url: string;
  linkedin_url: string;
  x_url: string;
}

interface Props {
  value: SocialLinks;
  onChange: (v: SocialLinks) => void;
  disabled?: boolean;
}

const FIELDS: { key: keyof SocialLinks; label: string; placeholder: string }[] = [
  { key: "facebook_url", label: "Facebook", placeholder: "https://facebook.com/…" },
  { key: "instagram_url", label: "Instagram", placeholder: "https://instagram.com/…" },
  { key: "tiktok_url", label: "TikTok", placeholder: "https://tiktok.com/@…" },
  { key: "youtube_url", label: "YouTube", placeholder: "https://youtube.com/@…" },
  { key: "linkedin_url", label: "LinkedIn", placeholder: "https://linkedin.com/in/…" },
  { key: "x_url", label: "X (Twitter)", placeholder: "https://x.com/…" },
];

export function SocialLinksSection({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-gray-800">{t("profile.socialLinks")}</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-sm text-gray-700">
            {f.label}
            <input
              type="url"
              value={value[f.key] ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
              disabled={disabled}
              placeholder={f.placeholder}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1D6BF3] disabled:bg-gray-50"
            />
          </label>
        ))}
      </div>
    </div>
  );
}