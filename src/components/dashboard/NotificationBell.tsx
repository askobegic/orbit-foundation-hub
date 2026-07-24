import { useEffect, useState, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { markAllNotificationsRead } from "@/lib/notifications.functions";

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

export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const lang = (i18n.language?.slice(0, 2) ?? "bs") as "bs" | "en" | "de";

  const markAll = useServerFn(markAllNotificationsRead);

  const query = useQuery({
    queryKey: ["notifications", "recent", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
  });

  const unread = (query.data ?? []).filter((n) => !n.is_read).length;

  // Realtime subscription
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          qc.invalidateQueries({ queryKey: ["notifications"] });
          qc.invalidateQueries({ queryKey: ["dashboard", "notifications"] });
          if (payload.eventType === "INSERT") {
            const row = payload.new as NotificationRow;
            const title =
              (lang === "bs" ? row.title_bs : lang === "de" ? row.title_de : row.title_en) ??
              row.title_en ?? "";
            const msg =
              (lang === "bs" ? row.message_bs : lang === "de" ? row.message_de : row.message_en) ??
              row.message_en ?? "";
            toast(title, { description: msg });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, qc, lang]);

  // Click-outside
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={t("dashboard.notifications")}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-50"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#EF4444] px-1 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-semibold">{t("notifications.title")}</span>
            <button
              type="button"
              onClick={handleMarkAll}
              className="flex items-center gap-1 text-xs font-medium text-[#1D6BF3] hover:underline"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t("notifications.markAllRead")}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {query.isLoading ? (
              <div className="p-4 text-sm text-gray-500">{t("common.loading")}</div>
            ) : (query.data ?? []).length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-500">{t("notifications.empty")}</div>
            ) : (
              (query.data ?? []).map((n) => {
                const title =
                  (lang === "bs" ? n.title_bs : lang === "de" ? n.title_de : n.title_en) ??
                  n.title_en ?? "";
                const msg =
                  (lang === "bs" ? n.message_bs : lang === "de" ? n.message_de : n.message_en) ??
                  n.message_en ?? "";
                return (
                  <div
                    key={n.id}
                    className={`border-b border-gray-50 px-4 py-3 last:border-0 ${
                      n.is_read ? "bg-white" : "bg-[#1D6BF3]/5"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.is_read && (
                        <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-[#1D6BF3]" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{title}</p>
                        <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{msg}</p>
                        {n.created_at && (
                          <p className="mt-1 text-[10px] uppercase tracking-wide text-gray-400">
                            {new Date(n.created_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <Link
            to="/dashboard/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-gray-100 bg-gray-50 px-4 py-2.5 text-center text-xs font-medium text-[#1D6BF3] hover:bg-gray-100"
          >
            {t("notifications.viewAll")}
          </Link>
        </div>
      )}
    </div>
  );
}