import { useState } from "react";
import { Send } from "lucide-react";

const MAX_LENGTH = 2000;

export interface ChatComposerProps {
  onSend: (body: string) => void | Promise<void>;
  disabled?: boolean;
}

// Plain text input + send button -- matches the DB's 2000-char cap
// (see supabase/migrations/20260731100000_messaging_system.sql).
export function ChatComposer({ onSend, disabled }: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || sending || disabled) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setValue("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-gray-100 bg-white p-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, MAX_LENGTH))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
          }
        }}
        rows={1}
        placeholder="Type a message…"
        disabled={disabled || sending}
        className="max-h-32 flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1D6BF3] disabled:bg-gray-50"
      />
      <button
        type="button"
        onClick={() => void handleSend()}
        disabled={disabled || sending || !value.trim()}
        aria-label="Send message"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1D6BF3] text-white hover:bg-[#155ac9] disabled:opacity-50"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
