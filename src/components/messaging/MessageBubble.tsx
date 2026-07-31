import { Check, CheckCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Message } from "@/types/messaging";

export interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
}

// Plain text only, immutable (no edit/delete). Read indicator is derived
// directly from read_at -- there is no separate "delivered" state to track
// (a successful insert already means delivered).
export function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  return (
    <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-4 py-2 text-sm",
          isOwn ? "bg-[#1D6BF3] text-white" : "bg-gray-100 text-gray-900",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            isOwn ? "text-white/70" : "text-gray-400",
          )}
        >
          <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {isOwn && (message.readAt ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
        </div>
      </div>
    </div>
  );
}
