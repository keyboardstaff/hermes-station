// Pure helpers for message-level operations (edit / regenerate / branch). Each
// starts a NEW session seeded with the prior transcript as the agent's context
// (`conversation_history`) — state.db can't be truncated per-message, so we
// branch forward rather than rewrite history in place. Kept side-effect-free so
// the truncation + text extraction are unit-tested without the chat runtime.

import type { ChatMessage } from "@/lib/hermes-types";

export interface BranchTurn {
  role: string;
  content: string;
}

/** Plain text of a message for branch context: text segments only (assistant
 *  tool / approval segments are dropped), else the legacy `content` string. */
export function messagePlainText(m: ChatMessage): string {
  const t = m.segments
    ? m.segments.filter((s) => s.type === "text").map((s) => (s.type === "text" ? s.content : "")).join("\n\n")
    : m.content;
  return (t ?? "").trim();
}

/** Build agent conversation history from the transcript up to (excluding)
 *  `uptoExclusive` — user/assistant turns only, tool cards stripped, empties
 *  dropped. Matches upstream's `get_messages_as_conversation` shape. */
export function buildBranchHistory(messages: ChatMessage[], uptoExclusive: number): BranchTurn[] {
  return messages
    .slice(0, Math.max(0, uptoExclusive))
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: messagePlainText(m) }))
    .filter((h) => h.content.length > 0);
}

/** Index of the user message that produced the assistant message at `idx` (the
 *  nearest user message before it), or -1 if none. */
export function precedingUserIndex(messages: ChatMessage[], idx: number): number {
  for (let i = Math.min(idx, messages.length) - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

/** 0-based position of the user message at `userIndex` among the *visible*
 *  user turns — the `truncate_before_user_ordinal` the backend expects to drop
 *  that turn (and everything after) before re-running. Counts only !hidden
 *  messages because state.db holds only the active path; hidden branch
 *  alternates exist client-side only. Mirrors the server's `user_indices`. */
export function userOrdinal(messages: ChatMessage[], userIndex: number): number {
  let n = 0;
  for (let i = 0; i < userIndex && i < messages.length; i++) {
    if (messages[i].role === "user" && !messages[i].hidden) n++;
  }
  return n;
}

/** Resolve an in-session edit target: the user message `sourceId` points at,
 *  plus the truncate ordinal the backend needs to drop that turn before
 *  re-running. Null when the id is unknown or not a user message. */
export function editTarget(
  messages: ChatMessage[],
  sourceId: string | null | undefined,
): { index: number; ordinal: number } | null {
  if (!sourceId) return null;
  const index = messages.findIndex((m) => m.id === sourceId);
  if (index < 0 || messages[index].role !== "user") return null;
  return { index, ordinal: userOrdinal(messages, index) };
}
