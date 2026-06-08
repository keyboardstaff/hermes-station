import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ChatMessage, ToolCall } from "@/lib/hermes-types";

/** Sentinel tool name carrying a frontend-synthetic approval notice through the
 *  tool-call part channel (rendered by AssistantThread's `tools.by_name`). */
export const APPROVAL_NOTICE_TOOL = "__hms_approval_notice__";

/** Plain-text projection of a Station message — feeds assistant-ui's internal
 *  copy / export and the action bar's copy/speak. */
export function messageText(msg: ChatMessage): string {
  if (msg.segments) {
    return msg.segments
      .filter((s) => s.type === "text")
      .map((s) => (s as { type: "text"; content: string }).content)
      .join("\n");
  }
  return msg.content;
}

type ContentArray = Extract<ThreadMessageLike["content"], readonly unknown[]>;
type ContentPart = ContentArray[number];

/** Round-trips a Station ToolCall through a tool-call part's `args`; the
 *  AssistantThread tool component reconstructs it and hands it to ToolCallCard,
 *  preserving Station's status enum / preview / duration / result. */
function toolPart(tc: ToolCall): ContentPart {
  return {
    type: "tool-call",
    toolCallId: tc.id,
    toolName: tc.toolName,
    args: { ...tc },
    argsText: tc.preview ?? "",
    result: tc.result,
  };
}

/**
 * Bridge a Station `ChatMessage` into an assistant-ui `ThreadMessageLike`.
 *
 * Assistant turns become ordered native content parts (reasoning → text /
 * tool-call / approval-notice, in segment order) so the transcript renders
 * through `MessagePrimitive.Parts`. User turns keep a single text part plus the
 * original message on `metadata.custom.hms` (the user bubble renders
 * attachments / agent-routing from it). Every message carries `hms` so the
 * message component can reach the agent label, streaming flag and action bar.
 */
export function toThreadMessage(msg: ChatMessage): ThreadMessageLike {
  const createdAt = new Date(msg.createdAt || Date.now());

  if (msg.role === "user") {
    return {
      id: msg.id,
      role: "user",
      createdAt,
      content: [{ type: "text", text: messageText(msg) }],
      metadata: { custom: { hms: msg } },
    };
  }

  const parts: ContentPart[] = [];
  if (msg.reasoning) parts.push({ type: "reasoning", text: msg.reasoning });
  if (msg.segments && msg.segments.length > 0) {
    for (const seg of msg.segments) {
      if (seg.type === "text") {
        if (seg.content) parts.push({ type: "text", text: seg.content });
      } else if (seg.type === "tool") {
        parts.push(toolPart(seg.tc));
      } else {
        parts.push({
          type: "tool-call",
          toolCallId: `approval-${msg.id}-${parts.length}`,
          toolName: APPROVAL_NOTICE_TOOL,
          args: { choice: seg.choice, command: seg.command },
          argsText: "",
        });
      }
    }
  } else if (msg.content) {
    parts.push({ type: "text", text: msg.content });
  }
  // assistant-ui needs at least one part to render the message shell.
  if (parts.length === 0) parts.push({ type: "text", text: "" });

  return {
    id: msg.id,
    role: "assistant",
    createdAt,
    content: parts,
    metadata: { custom: { hms: msg } },
  };
}
