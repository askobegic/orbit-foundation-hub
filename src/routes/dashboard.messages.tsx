import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { ConversationListItem } from "@/components/messaging/ConversationListItem";
import { useAuth } from "@/context/AuthContext";
import { useApplication } from "@/context/ApplicationContext";
import { supabase } from "@/integrations/supabase/client";
import { getApplicationCapabilities } from "@/lib/capabilities.functions";
import { getConversations, hideConversation } from "@/lib/conversation.functions";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/dashboard/messages")({
  head: () => ({
    meta: [
      { title: "Messages — Core Platform" },
      { name: "description", content: "Your conversations." },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <MessagesInbox />
    </ProtectedRoute>
  ),
});

function MessagesInbox() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { application } = useApplication();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const getConversationsFn = useServerFn(getConversations);
  const hideConversationFn = useServerFn(hideConversation);

  // R-2: matches the nav's own gating (DashboardPage.tsx's messagingEnabled)
  // so a direct URL visit can't reach an inbox the current application has
  // disabled messaging for. Existing conversations/messages are unaffected --
  // this only gates the page shell, not getConversations/hideConversation.
  const capabilitiesQuery = useQuery({
    queryKey: ["applicationCapabilities", application?.id],
    enabled: !!application?.id,
    queryFn: () => getApplicationCapabilities({ data: { appId: application!.id } }),
  });
  const messagingEnabled = !application || (capabilitiesQuery.data?.includes("messaging") ?? true);

  const query = useQuery({
    queryKey: ["conversations", user?.id],
    enabled: !!user?.id && messagingEnabled,
    queryFn: () => getConversationsFn({}),
  });

  // Two channels, not one -- postgres_changes filters don't support OR
  // conditions, so a conversation touching either side of the pair needs
  // its own subscription (see PROJECT_KNOWLEDGE.md -> Text Messaging ->
  // Real-time architecture).
  useEffect(() => {
    if (!user?.id) return;
    const channelA = supabase
      .channel(`conversations-a:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `user_a_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["conversations", user.id] }),
      )
      .subscribe();
    const channelB = supabase
      .channel(`conversations-b:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `user_b_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["conversations", user.id] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channelA);
      void supabase.removeChannel(channelB);
    };
  }, [user?.id, qc]);

  async function handleHide(conversationId: string) {
    try {
      await hideConversationFn({ data: { conversationId } });
      await qc.invalidateQueries({ queryKey: ["conversations", user?.id] });
    } catch {
      toast.error(t("common.errorGeneric"));
    }
  }

  const conversations = query.data ?? [];

  return (
    <div className="min-h-screen bg-[#F7F8FA] px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-2xl font-semibold text-gray-900">{t("messages.title")}</h1>
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
          {!messagingEnabled ? (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
              <MessageSquare className="h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">{t("messages.unavailable")}</p>
            </div>
          ) : query.isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
              <MessageSquare className="h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">{t("messages.empty")}</p>
            </div>
          ) : (
            conversations.map((c) => (
              <ConversationListItem
                key={c.id}
                otherUser={c.otherUser}
                lastMessage={c.lastMessage}
                unreadCount={c.unreadCount}
                isOwnLastMessage={c.lastMessage?.senderId === user?.id}
                onOpen={() =>
                  void navigate({ to: "/dashboard/messages/$conversationId", params: { conversationId: c.id } })
                }
                onHide={() => void handleHide(c.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
