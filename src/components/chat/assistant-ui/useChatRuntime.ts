import { useExternalStoreRuntime, type AppendMessage } from "@assistant-ui/react";
import { useChatStore } from "@/store/chat";
import { toThreadMessage } from "@/lib/chat-runtime";

/** Pulls the plain text out of an assistant-ui composer submission. */
function appendText(message: AppendMessage): string {
  return message.content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}

/**
 * Bridges Station's chat store to an assistant-ui external-store runtime.
 *
 * The store stays the single source of truth: `sendMessage` / `stopRun` (owned
 * by useRunsStream in ChatPanel) drive it, the store's `messages` flow into the
 * runtime via `convertMessage`, and the <Thread> re-renders from there.
 *
 * `isRunning` is intentionally left off in this phase — the live "working"
 * indicator is rendered by ChatBubble from `msg.streaming`, and omitting it
 * keeps assistant-ui from injecting an optimistic empty assistant bubble that
 * Station's store already owns. The composer remains Station's own, so `onNew`
 * is a thin bridge that stays dormant until the composer is migrated.
 */
export function useChatRuntime(opts: {
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const messages = useChatStore((s) => s.messages);
  return useExternalStoreRuntime({
    messages,
    convertMessage: toThreadMessage,
    onNew: async (message: AppendMessage) => {
      const text = appendText(message);
      if (text) opts.onSend(text);
    },
    onCancel: async () => {
      opts.onCancel();
    },
  });
}
