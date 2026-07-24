import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import i18n, { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

interface LanguageContextValue {
  language: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => Promise<void>;
  supported: readonly SupportedLanguage[];
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function normalize(lang: string | undefined | null): SupportedLanguage {
  if (!lang) return "bs";
  const short = lang.slice(0, 2).toLowerCase();
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(short)
    ? (short as SupportedLanguage)
    : "bs";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n: i18nInstance } = useTranslation();
  const { user, profile } = useAuth();
  const [, force] = useState(0);
  const syncedFromProfile = useRef(false);

  // Re-render this provider (and its consumers of `language`) whenever i18n
  // changes language, so the memoized value below reflects the new lang.
  useEffect(() => {
    const handler = () => force((n) => n + 1);
    i18nInstance.on("languageChanged", handler);
    return () => i18nInstance.off("languageChanged", handler);
  }, [i18nInstance]);

  // Sync signed-in user's preferred language from their profile ONCE per session,
  // and only if the user hasn't already made an explicit choice (localStorage).
  useEffect(() => {
    if (syncedFromProfile.current) return;
    if (!profile?.language) return;
    syncedFromProfile.current = true;
    const hasLocalChoice =
      typeof window !== "undefined" && !!window.localStorage.getItem("app.language");
    if (hasLocalChoice) return;
    const lang = normalize(profile.language);
    if (lang !== i18nInstance.language) void i18nInstance.changeLanguage(lang);
  }, [profile?.language, i18nInstance]);

  const setLanguage = useCallback(
    async (lang: SupportedLanguage) => {
      await i18n.changeLanguage(lang);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("app.language", lang);
      }
      if (user) {
        await supabase.from("profiles").update({ language: lang }).eq("id", user.id);
      }
    },
    [user],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language: normalize(i18nInstance.language),
      setLanguage,
      supported: SUPPORTED_LANGUAGES,
    }),
    [i18nInstance.language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return ctx;
}