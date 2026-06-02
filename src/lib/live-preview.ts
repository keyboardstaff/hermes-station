// Pure reducer helpers for the Sessions preview's live mirror, extracted from
// useLivePreview so the segment routing + bubble construction are unit-testable
// without standing up the WebSocket + react-query machinery (same rationale as
// run-events.ts). The hook imports these; behaviour is unchanged.

import type { ChatMessage, MessageSegment, ToolCall } from "@/lib/hermes-types";

/** Mutable accumulator for the in-flight turn — mirrors the chat store's
 *  segment routing so the preview renders text/tool ordering identically. */
export interface LiveAccumulator {
  userInput: string;
  reasoning: string;
  segments: MessageSegment[];
}

export function emptyAccumulator(): LiveAccumulator {
  return { userInput: "", reasoning: "", segments: [] };
}

/** Append a text delta the same way the chat store does: extend the trailing
 *  text segment, or open a new one after a tool segment. */
export function applyDelta(segments: MessageSegment[], delta: string): MessageSegment[] {
  const last = segments[segments.length - 1];
  if (last && last.type === "text") {
    return [...segments.slice(0, -1), { type: "text", content: last.content + delta }];
  }
  return [...segments, { type: "text", content: delta }];
}

/** Add a tool segment unless its id is already present (idempotent on replay). */
export function addTool(segments: MessageSegment[], tc: ToolCall): MessageSegment[] {
  if (segments.some((s) => s.type === "tool" && s.tc.id === tc.id)) return segments;
  return [...segments, { type: "tool", tc }];
}

/** Patch a tool segment's status/duration by id (no-op if not present). */
export function patchTool(
  segments: MessageSegment[],
  id: string,
  status: ToolCall["status"],
  duration: number | undefined,
): MessageSegment[] {
  return segments.map((s) =>
    s.type === "tool" && s.tc.id === id
      ? { ...s, tc: { ...s.tc, status, duration: duration ?? s.tc.duration } }
      : s,
  );
}

/** Build the in-flight turn's bubbles from the accumulator. Stable ids
 *  (`live-<runId>-*`) keep React keys steady across rebuilds; the assistant
 *  bubble only appears once there's something to show. */
export function buildLiveTurn(runId: string, startedAt: number, acc: LiveAccumulator): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (acc.userInput) {
    out.push({ id: `live-${runId}-user`, role: "user", content: acc.userInput, createdAt: startedAt });
  }
  if (acc.segments.length > 0 || acc.reasoning) {
    out.push({
      id: `live-${runId}-assistant`,
      role: "assistant",
      content: "",
      segments: [...acc.segments],
      reasoning: acc.reasoning || undefined,
      createdAt: startedAt + 1,
      streaming: true,
    });
  }
  return out;
}
