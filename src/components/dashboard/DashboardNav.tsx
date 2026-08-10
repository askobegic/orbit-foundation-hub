import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { ChevronRight, LogOut, Menu, X } from "lucide-react";

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
//
// Built directly on @radix-ui/react-dialog (the same primitive
// components/ui/sheet.tsx wraps) rather than a hand-rolled overlay, so
// focus-trapping, Escape-to-close, overlay-click-to-close, and body
// scroll-locking all come for free from the same accessible primitive
// already used elsewhere in this codebase -- composed directly here
// instead of through <Sheet>/<SheetContent> so the overlay/panel can match
// this Dashboard's own visual language (gray-100 borders, the brand blue
// gradient, rounded-xl cards) instead of the generic shadcn background/
// foreground tokens, without touching the shared sheet.tsx component other
// screens may depend on.
export function DashboardMobileNav() {
  const { t } = useTranslation();
  const { user, profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const flags = useDashboardWidgetFlags();
  const items = getDashboardNavItems(t, flags);
  const profileItem = items.find((item) => item.to === "/dashboard/profile");
  const navItems = items.filter((item) => item.to !== "/dashboard/profile");

  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const initials =
    (profile?.first_name?.[0] ?? "") + (profile?.last_name?.[0] ?? "") || (user?.email?.[0] ?? "?");

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={t("nav.openMenu")}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 lg:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[80vw] flex-col border-r border-gray-100 bg-white shadow-xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:duration-200 data-[state=open]:duration-300 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left lg:hidden"
        >
          {/* Header: CORE identity + close button, matching the desktop
              Sidebar's own header exactly so mobile and desktop read as the
              same platform navigation, not two different products. */}
          <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 pt-[env(safe-area-inset-top)]">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#1D6BF3] to-[#6366F1] text-sm font-bold text-white">
                C
              </div>
              <DialogPrimitive.Title className="text-sm font-semibold text-gray-900">
                Core Platform
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label={t("nav.closeMenu")}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </DialogPrimitive.Close>
          </div>

          {/* Profile summary: pulled out of the flat destination list and
              given its own card so it (and logout, in the footer below)
              read as account-level actions, visually distinct from the
              platform's navigation destinations. */}
          {profileItem && (
            <Link
              to={profileItem.to}
              onClick={() => setOpen(false)}
              className="mx-3 mt-3 flex shrink-0 items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3 transition hover:bg-gray-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#1D6BF3] to-[#6366F1] text-xs font-semibold text-white">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials.toUpperCase()
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-900">
                  {fullName || user?.email}
                </span>
                <span className="block truncate text-xs text-gray-500">{profileItem.label}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
            </Link>
          )}

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
            {navItems.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                activeOptions={{ exact: true }}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
                activeProps={{
                  className:
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium bg-[#1D6BF3]/10 text-[#1D6BF3]",
                }}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{item.label}</span>
              </Link>
            ))}
          </nav>

          <div className="border-t border-gray-100 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{t("nav.logout")}</span>
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
