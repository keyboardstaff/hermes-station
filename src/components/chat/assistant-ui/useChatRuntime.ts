import { useMemo, useRef } from "react";
import {
  useExternalStoreRuntime,
  ExportedMessageRepository,
  type AppendMessage,
  type ThreadMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useChatStore } from "@/store/chat";
import { branchableItems } from "@/lib/chat-runtime";
import { editTarget } from "@/lib/branch";
import type { ChatMessage } from "@/lib/hermes-types";

export interface ChatSendOptions {
  truncateBeforeUserOrdinal?: number;
  reuseExistingUserBubble?: boolean;
}

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
 * by useRunsStream in ChatPanel) drive it, and its `messages` flow into the
 * runtime as a branchable message repository — regenerated answers sharing a
 * `branchGroupId` become sibling branches (BranchPicker 1/2), everything else
 * stays a linear chain. Switching branches calls back through `setMessages`
 * with the new active path; `applyBranchVisibility` flips `hidden` flags to
 * match (in-memory only, mirroring upstream desktop).
 *
 * `isRunning` gates branch switching during a run (the runtime ignores
 * switches while streaming). `onEdit` backs the native inline edit composer:
 * an edited user prompt drops its old turn locally (linear replace, no branch
 * — matching upstream desktop) and re-runs with the matching backend truncate.
 * The main composer remains Station's own, so `onNew` is a thin bridge that
 * stays dormant until the composer is migrated.
 */
export function useChatRuntime(opts: {
  onSend: (text: string, sendOpts?: ChatSendOptions) => void;
  onCancel: () => void;
}) {
  const messages = useChatStore((s) => s.messages);
  const isRunning = useChatStore((s) => s.activeRunId != null);
  const applyBranchVisibility = useChatStore((s) => s.applyBranchVisibility);

  // Conversion cache keyed by message object identity — only messages the
  // store actually replaced get reconverted on a streaming delta.
  const cacheRef = useRef(new WeakMap<ChatMessage, ThreadMessageLike>());
  const messageRepository = useMemo(() => {
    const { items, headId } = branchableItems(messages, cacheRef.current);
    return ExportedMessageRepository.fromBranchableArray(items, { headId });
  }, [messages]);

  return useExternalStoreRuntime({
    messageRepository,
    isRunning,
    setMessages: (next: readonly ThreadMessage[]) =>
      applyBranchVisibility(next.map((m) => m.id)),
    onNew: async (message: AppendMessage) => {
      const text = appendText(message);
      if (text) opts.onSend(text);
    },
    onEdit: async (edited: AppendMessage) => {
      const state = useChatStore.getState();
      if (state.activeRunId) return; // no edits while a run streams
      const text = appendText(edited);
      // sourceId = the message being edited; parentId (the message before it)
      // is the fallback for older AppendMessage shapes, mirroring desktop.
      const target = editTarget(state.messages, edited.sourceId ?? edited.parentId);
      if (!text || !target) return;
      state.truncateMessagesBefore(target.index);
      opts.onSend(text, { truncateBeforeUserOrdinal: target.ordinal });
    },
    onCancel: async () => {
      opts.onCancel();
    },
  });
}
