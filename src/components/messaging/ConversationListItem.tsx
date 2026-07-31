import { EyeOff } from "lucide-react";

import type { OtherUser } from "@/lib/conversation.functions";
import type { Message } from "@/types/messaging";

export interface ConversationListItemProps {
  otherUser: OtherUser | null;
  lastMessage: Message | null;
  unreadCount: number;
  isOwnLastMessage: boolean;
  onOpen: () => void;
  onHide: () => void;
}

// One Inbox row -- other participant's name/avatar, last message preview,
// relative timestamp, unread badge. No online/offline indicator and no
// per-conversation application badge (see PROJECT_KNOWLEDGE.md -> Text
// Messaging: Premium is ecosystem-wide, so a conversation has no fixed
// "origin application" identity to display).
export function ConversationListItem({
  otherUser,
  lastMessage,
  unreadCount,
  isOwnLastMessage,
  onOpen,
  onHide,
}: ConversationListItemProps) {
  const fullName = [otherUser?.firstName, otherUser?.lastName].filter(Boolean).join(" ").trim();
  const displayName = fullName || (otherUser?.username ? `@${otherUser.username}` : "");

  return (
    <div className="group flex items-center gap-3 border-b border-gray-50 px-4 py-3 last:border-0 hover:bg-gray-50">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-gray-100">
          {otherUser?.avatarUrl ? (
            <img src={otherUser.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-400">?</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-gray-900">{displayName}</span>
            {lastMessage && (
              <span className="shrink-0 text-xs text-gray-400">
                {new Date(lastMessage.createdAt).toLocaleDateString()}
              </span>
            )}
          </div>
          <p className="truncate text-sm text-gray-500">
            {lastMessage ? `${isOwnLastMessage ? "You: " : ""}${lastMessage.body}` : ""}
          </p>
        </div>
        {unreadCount > 0 && (
          <span className="ml-2 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#1D6BF3] px-1.5 text-[11px] font-semibold text-white">
            {unreadCount}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onHide}
        aria-label="Hide conversation"
        className="shrink-0 rounded-lg p-2 text-gray-300 opacity-0 hover:bg-gray-100 hover:text-gray-600 group-hover:opacity-100"
      >
        <EyeOff className="h-4 w-4" />
      </button>
    </div>
  );
}
