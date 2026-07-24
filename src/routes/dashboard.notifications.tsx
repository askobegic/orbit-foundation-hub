import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bell, CheckCheck } from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications.functions";

type NotificationRow = {
  id: string;
  title_bs: string | null;
  title_en: string | null;
  title_de: string | null;
  message_bs: string | null;
  message_en: string | null;
  message_de: string | null;
  type: string | null;
  is_read: boolean | null;
  created_at: string | null;
};

export const Route = createFileRoute("/dashboard/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Core Platform" },
      { name: "description", content: "All your notifications in one place." },
      { property: "og:title", content: "Notifications — Core Platform" },
      { property: "og:description", content: "All your notifications in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <NotificationsPage />
    </ProtectedRoute>
  ),
});

function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const lang = (i18n.language?.slice(0, 2) ?? "bs") as "bs" | "en" | "de";

  const markAll = useServerFn(markAllNotificationsRead);
  const markOne = useServerFn(markNotificationRead);

  const query = useQuery({
    queryKey: ["notifications", "all", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-page:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["notifications"] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);

  async function handleMarkAll() {
    try {
      await markAll({});
      await qc.invalidateQueries({ queryKey: ["notifications"] });
      await qc.invalidateQueries({ queryKey: ["dashboard", "notifications"] });
      toast.success(t("notifications.allMarkedRead"));
    } catch {
      toast.error(t("common.errorGeneric"));
    }
  }

  async function handleMarkOne(id: string) {
    try {
      await markOne({ data: { id } });
      await qc.invalidateQueries({ queryKey: ["notifications"] });
      await qc.invalidateQueries({ queryKey: ["dashboard", "notifications"] });
    } catch {
      toast.error(t("common.errorGeneric"));
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA] px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{t("notifications.title")}</h1>
            <p className="text-sm text-gray-500">{t("notifications.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={handleMarkAll}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <CheckCheck className="h-4 w-4" />
            {t("notifications.markAllRead")}
          </button>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          {query.isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (query.data ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
              <Bell className="h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">{t("notifications.empty")}</p>
            </div>
          ) : (
            (query.data ?? []).map((n) => {
              const title =
                (lang === "bs" ? n.title_bs : lang === "de" ? n.title_de : n.title_en) ??
                n.title_en ?? "";
              const msg =
                (lang === "bs" ? n.message_bs : lang === "de" ? n.message_de : n.message_en) ??
                n.message_en ?? "";
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => !n.is_read && handleMarkOne(n.id)}
                  className={`flex w-full items-start gap-3 border-b border-gray-50 px-6 py-4 text-left last:border-0 hover:bg-gray-50 ${
                    n.is_read ? "bg-white" : "bg-[#1D6BF3]/5"
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 flex-none rounded-full ${
                      n.is_read ? "bg-transparent" : "bg-[#1D6BF3]"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{title}</p>
                    <p className="mt-0.5 text-sm text-gray-600">{msg}</p>
                    {n.created_at && (
                      <p className="mt-1 text-xs text-gray-400">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}