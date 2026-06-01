// Pure run-event helpers extracted from useRunsStream so the
// branch-heavy bits — tool-status resolution, the seq-dedup guard, and the
// tool-call id derivation — are unit-testable without standing up the hook's
// store + WebSocket machinery. The hook imports these; behaviour is unchanged.

import type { ToolCall } from "@/lib/hermes-types";
import type { RunEventMessage } from "@/lib/ws-types";

/**
 * Whether a frame should be applied, given the highest seq already applied.
 * Frames with no `seq` (legacy) always pass; otherwise only strictly-newer
 * seqs pass — this drops reconnect-replay duplicates. Returns the new
 * high-water mark alongside the decision so the caller advances it atomically.
 */
export function shouldApplyFrame(
  seq: number | undefined,
  lastSeq: number,
): { apply: boolean; lastSeq: number } {
  if (typeof seq !== "number") return { apply: true, lastSeq };
  if (seq <= lastSeq) return { apply: false, lastSeq };
  return { apply: true, lastSeq: seq };
}

/**
 * The card id for a tool frame: the upstream `tool_call_id` when present (so it
 * matches the DB's role:tool row on reconcile), else a run+name-scoped fallback
 * (collides only for concurrent same-name calls on a legacy frame).
 */
export function toolCallId(runId: string, msg: Pick<RunEventMessage, "tool" | "tool_call_id">): string {
  return msg.tool_call_id ?? `tc-${runId}-${msg.tool}`;
}

/**
 * Resolve a `tool.completed` frame to a `ToolCall["status"]`. Precedence:
 * cancelled/timeout/approval_required (from either `status` or `error`) win
 * over a generic `status` passthrough, which wins over the error/done default.
 */
export function mapToolStatus(msg: Pick<RunEventMessage, "status" | "error">): ToolCall["status"] {
  let status: ToolCall["status"] = msg.error ? "error" : "done";
  if (msg.status === "cancelled" || msg.error === "cancelled") {
    status = "cancelled";
  } else if (msg.status === "timeout" || msg.error === "timeout") {
    status = "timeout";
  } else if (msg.status === "approval_required") {
    status = "approval_required";
  } else if (msg.status) {
    status = msg.status as ToolCall["status"];
  }
  return status;
}
