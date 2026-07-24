import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import bs from "@/locales/bs.json";
import en from "@/locales/en.json";
import de from "@/locales/de.json";

export const SUPPORTED_LANGUAGES = ["bs", "en", "de"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {
        bs: { translation: bs },
        en: { translation: en },
        de: { translation: de },
      },
      fallbackLng: "bs",
      supportedLngs: SUPPORTED_LANGUAGES,
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
        lookupLocalStorage: "app.language",
      },
    });
}

export default i18n;