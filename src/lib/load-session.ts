/** Single load path for a session's transcript — DB rows + attachment enrichment.
 *  Both the session-switch loader (ChatPanel) and the run-completion reconcile
 *  (useRunsStream) go through here so they can never diverge. */
import { api } from "@/lib/api";
import {
  historyToChatMessages,
  enrichMessagesWithAttachments,
  type MessageRow,
  type SessionAttachment,
} from "@/lib/session-messages";
import type { ChatMessage } from "@/lib/hermes-types";

export async function loadSessionMessages(
  sessionId: string,
  limit = 200,
): Promise<ChatMessage[]> {
  const data = await api.get<{ messages: MessageRow[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}`,
  );
  const base = historyToChatMessages(data.messages);
  try {
    const attData = await api.get<{ attachments: SessionAttachment[] }>(
      `/api/upload/session/${encodeURIComponent(sessionId)}`,
    );
    return enrichMessagesWithAttachments(base, attData.attachments ?? []);
  } catch {
    // Attachments are best-effort; transcript still renders without them.
    return base;
  }
}

/** Extract tool_call_id → result body from raw DB rows (for by-id card patching). */
export function toolResultsById(rows: MessageRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of rows) {
    if (m.role === "tool" && m.tool_call_id && typeof m.content === "string" && m.content) {
      out[m.tool_call_id] = m.content;
    }
  }
  return out;
}
