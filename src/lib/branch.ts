// Pure helpers for message-level operations (edit / regenerate / branch),
// kept side-effect-free so ordinal math + text extraction are unit-tested
// without the chat runtime. Regenerate / edit rewrite the session in place
// (backend `truncate_before_user_ordinal`); branch clones the transcript
// prefix into a new session (`POST /api/sessions/{id}/branch`).

import type { ChatMessage } from "@/lib/hermes-types";

/** Plain text of a message for resend / copy: text segments only (assistant
 *  tool / approval segments are dropped), else the legacy `content` string. */
export function messagePlainText(m: ChatMessage): string {
  const t = m.segments
    ? m.segments.filter((s) => s.type === "text").map((s) => (s.type === "text" ? s.content : "")).join("\n\n")
    : m.content;
  return (t ?? "").trim();
}

/** DB row id of the first message after `idx` that maps to a persisted row
 *  (`hist-<rowId>` user rows / `hist-run-<firstRowId>` assistant runs) — the
 *  exclusive cut a branch-from-here sends the backend. Null when nothing
 *  persisted follows (branching at the tail): clone the whole transcript. */
export function nextHistRowId(messages: ChatMessage[], idx: number): number | null {
  for (let i = idx + 1; i < messages.length; i++) {
    const m = /^hist-(?:run-)?(\d+)/.exec(messages[i].id);
    if (m) return Number(m[1]);
  }
  return null;
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
