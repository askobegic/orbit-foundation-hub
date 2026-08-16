// Universal Pre-Launch Front Page (CORE-connected applications only -- see
// LaunchGate.tsx, which never renders this for the CORE platform itself).
// Purely presentational: renders whatever the admin configured for the
// current application via application_pre_launch_content. No
// application-specific content is ever hardcoded here -- an application
// with nothing configured yet renders only the generic, localized
// "currently being prepared" fallback text.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Facebook, Instagram, Mail, Music2, Phone, Youtube } from "lucide-react";
import type { ComponentType } from "react";

import { getPreLaunchContent, type PreLaunchContent } from "@/lib/launch.functions";
import { isSafeProfileUrl } from "@/lib/url";
import type { ApplicationBranding } from "@/lib/application-resolver.functions";

const SOCIAL_LINKS: {
  key: "facebookUrl" | "instagramUrl" | "tiktokUrl" | "youtubeUrl";
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { key: "facebookUrl", label: "Facebook", icon: Facebook },
  { key: "instagramUrl", label: "Instagram", icon: Instagram },
  { key: "tiktokUrl", label: "TikTok", icon: Music2 },
  { key: "youtubeUrl", label: "YouTube", icon: Youtube },
];

function localizedField(
  content: PreLaunchContent | undefined,
  base: "title" | "infoText",
  lang: "bs" | "en" | "de",
): string | null {
  if (!content) return null;
  const cap = lang.charAt(0).toUpperCase() + lang.slice(1);
  const value = content[`${base}${cap}` as keyof PreLaunchContent];
  return typeof value === "string" && value.trim() ? value : null;
}

export function PreLaunchFrontPage({ application }: { application: ApplicationBranding }) {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language?.slice(0, 2) ?? "bs") as "bs" | "en" | "de";
  const getContentFn = useServerFn(getPreLaunchContent);
  const contentQ = useQuery({
    queryKey: ["pre-launch-content", application.id],
    queryFn: () => getContentFn({ data: { appId: application.id } }),
    staleTime: 60_000,
  });
  const content = contentQ.data;

  const title = localizedField(content, "title", lang) ?? application.name;
  const infoText =
    localizedField(content, "infoText", lang) ?? t("launch.preLaunch.defaultInfoText");
  const logoUrl =
    content?.logoUrl && isSafeProfileUrl(content.logoUrl) ? content.logoUrl : application.logo_url;
  const bannerUrl =
    content?.bannerImageUrl && isSafeProfileUrl(content.bannerImageUrl)
      ? content.bannerImageUrl
      : null;

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center"
      style={{
        background: `linear-gradient(135deg, ${application.primary_color} 0%, ${application.secondary_color} 100%)`,
      }}
    >
      <div className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-xl sm:p-10">
        {bannerUrl && (
          <img src={bannerUrl} alt="" className="mb-6 h-40 w-full rounded-2xl object-cover" />
        )}
        {logoUrl && (
          <img src={logoUrl} alt="" className="mx-auto mb-4 h-16 w-16 rounded-xl object-contain" />
        )}
        <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        <p className="mt-3 whitespace-pre-line text-sm text-gray-600">{infoText}</p>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-400">
          {t("launch.preLaunch.badge")}
        </p>

        {content && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {SOCIAL_LINKS.map(({ key, label, icon: Icon }) => {
              const url = content[key];
              if (!url || !isSafeProfileUrl(url)) return null;
              return (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition hover:bg-gray-200"
                >
                  <Icon className="h-4 w-4" />
                </a>
              );
            })}
            {content.contactEmail && (
              <a
                href={`mailto:${content.contactEmail}`}
                className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-200"
              >
                <Mail className="h-3.5 w-3.5" />
                {content.contactEmail}
              </a>
            )}
            {content.contactPhone && (
              <a
                href={`tel:${content.contactPhone}`}
                className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-200"
              >
                <Phone className="h-3.5 w-3.5" />
                {content.contactPhone}
              </a>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
