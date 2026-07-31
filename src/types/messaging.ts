// Messaging Foundation (Priority 6) -- types only. No backing tables exist
// yet (conversations/messages are not created by any migration). These
// mirror the proposed data model in PROJECT_KNOWLEDGE.md -> Profile Card &
// Messaging System -> Text Messaging, so ConversationService/MessageService
// have a real contract to implement against once messaging itself (Priority
// 7+) is explicitly approved.
//
// One-on-one only, text only -- see PROJECT_KNOWLEDGE.md for the full,
// permanent set of constraints (no groups, no media/voice/calls).

export interface Conversation {
  id: string;
  userAId: string;
  userBId: string;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

// Inbox row shape (Conversation + the data an Inbox list needs to render
// one row) -- see PROJECT_KNOWLEDGE.md -> Inbox.
export interface ConversationSummary extends Conversation {
  lastMessage: Message | null;
  unreadCount: number;
}
