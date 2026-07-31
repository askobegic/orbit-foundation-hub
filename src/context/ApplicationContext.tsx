import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { resolveApplication, type ApplicationBranding } from "@/lib/application-resolver.functions";
import { ApplicationSelector } from "@/components/dev/ApplicationSelector";

interface ApplicationContextValue {
  application: ApplicationBranding | null;
  loading: boolean;
}

const ApplicationContext = createContext<ApplicationContextValue | undefined>(undefined);

function applyFavicon(url: string | null) {
  if (!url) return;
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

function readInitialOverrideSlug(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("app") ?? undefined;
}

export function ApplicationProvider({ children }: { children: ReactNode }) {
  const resolve = useServerFn(resolveApplication);
  const [overrideSlug, setOverrideSlug] = useState<string | undefined>(readInitialOverrideSlug);

  const { data, isLoading } = useQuery({
    queryKey: ["application-resolve", overrideSlug ?? null],
    queryFn: () => resolve({ data: { overrideSlug } }),
    staleTime: Infinity,
  });

  const application = data ?? null;

  // Progressive enhancement only: the first server-rendered byte (before
  // this resolves) shows the neutral default in __root.tsx's head(). Once
  // resolved, title/favicon are swapped to the current application's own
  // branding so every page reflects it, not just components that read
  // useApplication() directly.
  useEffect(() => {
    if (!application) return;
    document.title = application.name;
    applyFavicon(application.favicon_url);
  }, [application]);

  return (
    <ApplicationContext.Provider value={{ application, loading: isLoading }}>
      {!isLoading && !application ? <ApplicationSelector onSelect={setOverrideSlug} /> : children}
    </ApplicationContext.Provider>
  );
}

export function useApplication(): ApplicationContextValue {
  const ctx = useContext(ApplicationContext);
  if (!ctx) throw new Error("useApplication must be used inside <ApplicationProvider>");
  return ctx;
}
