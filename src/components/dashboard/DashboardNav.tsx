import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { LogOut, Menu, X } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useApplication } from "@/context/ApplicationContext";
import { getDashboardWidgets } from "@/lib/dashboard-widgets.functions";
import { getDashboardNavItems, type DashboardWidgetFlags } from "@/lib/dashboard-nav";

// Hook shared by the desktop Sidebar and the mobile drawer so both read the
// same enabled/disabled widget set (Priority 8.2: Dashboard Widget
// Modularity) instead of each re-deriving it independently.
function useDashboardWidgetFlags(): DashboardWidgetFlags {
  const { application } = useApplication();
  const getDashboardWidgetsFn = useServerFn(getDashboardWidgets);
  const widgetsQuery = useQuery({
    queryKey: ["dashboard-widgets", application?.id],
    enabled: !!application?.id,
    queryFn: () => getDashboardWidgetsFn({ data: { appId: application!.id } }),
  });
  const isWidgetEnabled = (key: string) =>
    !application || (widgetsQuery.data?.includes(key) ?? true);
  return {
    rewardsEnabled: isWidgetEnabled("rewards"),
    advertisingEnabled: isWidgetEnabled("advertising"),
    messagingEnabled: isWidgetEnabled("messaging"),
  };
}

// Professional mobile/tablet navigation: a hamburger trigger (visible below
// the `lg` breakpoint, matching the desktop Sidebar's own `lg:flex`
// threshold in DashboardPage.tsx) that opens an off-canvas drawer with the
// same destinations as the desktop Sidebar. Self-contained -- every
// dashboard page can render <DashboardMobileNav /> in its own header with no
// props required, so every dashboard page gets the same reachability the
// desktop Sidebar already provides, without each page re-deriving auth,
// application, or widget state itself.
export function DashboardMobileNav() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const flags = useDashboardWidgetFlags();
  const items = getDashboardNavItems(t, flags);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("nav.openMenu")}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex bg-black/40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t("nav.openMenu")}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="flex h-full w-72 max-w-[80vw] flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between gap-2 border-b border-gray-100 px-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#1D6BF3] to-[#6366F1] text-sm font-bold text-white">
                  C
                </div>
                <span className="text-sm font-semibold">Core Platform</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("nav.closeMenu")}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
              {items.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  activeOptions={{ exact: true }}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
                  activeProps={{
                    className:
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium bg-[#1D6BF3]/10 text-[#1D6BF3]",
                  }}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{item.label}</span>
                </Link>
              ))}
            </nav>
            <div className="border-t border-gray-100 p-3">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{t("nav.logout")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
