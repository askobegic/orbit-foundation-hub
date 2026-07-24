import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "install_prompt_dismissed_at";
const DISMISS_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function InstallPrompt() {
  const { t } = useTranslation();
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (dismissed && Date.now() - dismissed < DISMISS_MS) return;

    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", handler as EventListener);

    // iOS fallback — no beforeinstallprompt on Safari
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIOS) {
      setShowIOS(true);
      setVisible(true);
    }

    return () =>
      window.removeEventListener("beforeinstallprompt", handler as EventListener);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const install = async () => {
    if (!evt) return;
    await evt.prompt();
    await evt.userChoice;
    setEvt(null);
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-sm rounded-2xl border border-gray-100 bg-white p-4 shadow-xl lg:left-auto lg:right-6 lg:mx-0">
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        aria-label={t("common.close")}
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#1D6BF3] to-[#6366F1] text-sm font-bold text-white">
          C
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">{t("install.title")}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {showIOS ? t("install.iosHint") : t("install.hint")}
          </p>
          {!showIOS && (
            <button
              type="button"
              onClick={install}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#1D6BF3] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1758C6]"
            >
              <Download className="h-3.5 w-3.5" />
              {t("install.cta")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}