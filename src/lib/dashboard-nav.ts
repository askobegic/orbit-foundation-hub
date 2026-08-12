import {
  Home,
  User,
  LayoutGrid,
  CreditCard,
  Settings,
  Shield,
  Bell,
  HelpCircle,
  Gift,
  Megaphone,
  MessageSquare,
  Users,
} from "lucide-react";

export interface DashboardWidgetFlags {
  rewardsEnabled: boolean;
  advertisingEnabled: boolean;
  messagingEnabled: boolean;
}

// Single source of truth for the dashboard's navigation destinations --
// shared by the desktop Sidebar (DashboardPage.tsx) and the mobile/tablet
// drawer (DashboardNav.tsx), so the two can never drift out of sync.
export function getDashboardNavItems(t: (key: string) => string, flags: DashboardWidgetFlags) {
  return [
    { to: "/dashboard", icon: Home, label: t("nav.home") },
    { to: "/dashboard/profile", icon: User, label: t("nav.profile") },
    { to: "/dashboard", icon: LayoutGrid, label: t("nav.applications") },
    // CORE Members System -- one shared directory/search page, reused by
    // every connected application (see src/routes/members.tsx). Always
    // reachable, not gated by a widget flag, same tier as Profile/Settings.
    { to: "/members", icon: Users, label: t("nav.members") },
    { to: "/dashboard/purchases", icon: CreditCard, label: t("nav.purchases") },
    ...(flags.rewardsEnabled
      ? [{ to: "/dashboard/rewards" as const, icon: Gift, label: t("nav.rewards") }]
      : []),
    ...(flags.advertisingEnabled
      ? [{ to: "/dashboard/advertising" as const, icon: Megaphone, label: t("nav.advertising") }]
      : []),
    { to: "/dashboard/settings", icon: Settings, label: t("nav.settings") },
    { to: "/dashboard/security", icon: Shield, label: t("nav.security") },
    { to: "/dashboard/notifications", icon: Bell, label: t("nav.notifications") },
    ...(flags.messagingEnabled
      ? [{ to: "/dashboard/messages" as const, icon: MessageSquare, label: t("nav.messages") }]
      : []),
    { to: "/dashboard/help", icon: HelpCircle, label: t("nav.help") },
  ] as const;
}
