import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ChatMessage } from "@/lib/hermes-types";

/** Plain-text projection of a Station message — feeds assistant-ui's internal
 *  copy / export. The visible body is still rendered by ChatBubble from the
 *  original ChatMessage carried in `metadata.custom.hms`, so nothing here is
 *  lossy for the user; this is only the text assistant-ui keeps for itself. */
export function messageText(msg: ChatMessage): string {
  if (msg.segments) {
    return msg.segments
      .filter((s) => s.type === "text")
      .map((s) => (s as { type: "text"; content: string }).content)
      .join("\n");
  }
  return msg.content;
}

/**
 * Bridge a Station `ChatMessage` into an assistant-ui `ThreadMessageLike`.
 *
 * The initial step of the @assistant-ui adoption keeps Station's mature
 * rendering (markdown / tool cards / reasoning / attachments via ChatBubble)
 * intact: the whole ChatMessage rides along in `metadata.custom.hms` and the
 * message component reads it back. assistant-ui owns the runtime, the
 * thread/message list and the streaming lifecycle; the segment→content-part
 * conversion that unlocks native tool cards and branching lands later.
 */
export function toThreadMessage(msg: ChatMessage): ThreadMessageLike {
  const role: "user" | "assistant" = msg.role === "user" ? "user" : "assistant";
  return {
    id: msg.id,
    role,
    createdAt: new Date(msg.createdAt || Date.now()),
    content: [{ type: "text", text: messageText(msg) }],
    metadata: { custom: { hms: msg } },
  };
}
