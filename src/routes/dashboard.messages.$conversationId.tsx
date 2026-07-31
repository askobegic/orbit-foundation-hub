import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { ChatComposer } from "@/components/messaging/ChatComposer";
import { MessageBubble } from "@/components/messaging/MessageBubble";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getMessages, markConversationRead, sendMessage } from "@/lib/message.functions";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/dashboard/messages/$conversationId")({
  head: () => ({
    meta: [{ title: "Chat — Core Platform" }],
  }),
  component: () => (
    <ProtectedRoute>
      <ChatThread />
    </ProtectedRoute>
  ),
});

type OtherParticipant = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  username: string | null;
};

function ChatThread() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { conversationId } = Route.useParams();
  const qc = useQueryClient();
  const getMessagesFn = useServerFn(getMessages);
  const sendMessageFn = useServerFn(sendMessage);
  const markReadFn = useServerFn(markConversationRead);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [otherUser, setOtherUser] = useState<OtherParticipant | null>(null);

  const messagesQuery = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => getMessagesFn({ data: { conversationId } }),
  });

  useEffect(() => {
    void (async () => {
      const { data: convo } = await supabase
        .from("conversations")
        .select("user_a_id, user_b_id")
        .eq("id", conversationId)
        .maybeSingle();
      if (!convo || !user) return;
      const otherId = convo.user_a_id === user.id ? convo.user_b_id : convo.user_a_id;
      const { data: profile } = await supabase
        .from("profiles_public")
        .select("id, first_name, last_name, avatar_url, username")
        .eq("id", otherId)
        .maybeSingle();
      if (profile) {
        setOtherUser({
          id: profile.id!,
          firstName: profile.first_name,
          lastName: profile.last_name,
          avatarUrl: profile.avatar_url,
          username: profile.username,
        });
      }
    })();
  }, [conversationId, user]);

  useEffect(() => {
    void markReadFn({ data: { conversationId } }).catch(() => {});
  }, [conversationId, markReadFn]);

  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["messages", conversationId] });
          void markReadFn({ data: { conversationId } }).catch(() => {});
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, qc, markReadFn]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messagesQuery.data]);

  async function handleSend(body: string) {
    try {
      await sendMessageFn({ data: { conversationId, body } });
      await qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      await qc.invalidateQueries({ queryKey: ["conversations", user?.id] });
    } catch {
      toast.error(t("common.errorGeneric"));
    }
  }

  const fullName = [otherUser?.firstName, otherUser?.lastName].filter(Boolean).join(" ").trim();
  const displayName = fullName || (otherUser?.username ? `@${otherUser.username}` : "");

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F8FA]">
      <header className="flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3">
        <Link to="/dashboard/messages" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="h-9 w-9 overflow-hidden rounded-full bg-gray-100">
          {otherUser?.avatarUrl ? (
            <img src={otherUser.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-400">?</div>
          )}
        </div>
        <span className="text-sm font-semibold text-gray-900">{displayName}</span>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messagesQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-2/3" />
            ))}
          </div>
        ) : (
          (messagesQuery.data ?? []).map((m) => (
            <MessageBubble key={m.id} message={m} isOwn={m.senderId === user?.id} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <ChatComposer onSend={handleSend} />
    </div>
  );
}
