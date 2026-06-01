// the branch-heavy run-event helpers extracted from useRunsStream:
// seq-dedup, tool-call id derivation, and tool.completed status resolution.
// These pin current behaviour so the chat-runtime hook can be refactored
// without silently changing how frames are deduped or how tool states map.

import { describe, it, expect } from "vitest";
import { shouldApplyFrame, toolCallId, mapToolStatus } from "@/lib/run-events";

describe("shouldApplyFrame", () => {
  it("applies and advances on a strictly-newer seq", () => {
    expect(shouldApplyFrame(5, 3)).toEqual({ apply: true, lastSeq: 5 });
  });

  it("drops an already-applied seq (reconnect replay) without rewinding", () => {
    expect(shouldApplyFrame(3, 3)).toEqual({ apply: false, lastSeq: 3 });
    expect(shouldApplyFrame(2, 3)).toEqual({ apply: false, lastSeq: 3 });
  });

  it("passes legacy frames (no seq) without changing the high-water mark", () => {
    expect(shouldApplyFrame(undefined, 7)).toEqual({ apply: true, lastSeq: 7 });
  });

  it("applies the first real seq from a fresh stream (lastSeq 0)", () => {
    expect(shouldApplyFrame(1, 0)).toEqual({ apply: true, lastSeq: 1 });
  });
});

describe("toolCallId", () => {
  it("uses the upstream tool_call_id when present", () => {
    expect(toolCallId("r1", { tool: "bash", tool_call_id: "call_abc" })).toBe("call_abc");
  });

  it("falls back to a run+name-scoped id on a legacy frame", () => {
    expect(toolCallId("r1", { tool: "bash" })).toBe("tc-r1-bash");
  });

  it("scopes the fallback by run id so two runs don't collide", () => {
    expect(toolCallId("r2", { tool: "bash" })).toBe("tc-r2-bash");
  });
});

describe("mapToolStatus", () => {
  it("defaults to done with no error", () => {
    expect(mapToolStatus({})).toBe("done");
  });

  it("maps a truthy error to error", () => {
    expect(mapToolStatus({ error: true })).toBe("error");
    expect(mapToolStatus({ error: "boom" })).toBe("error");
  });

  it("cancelled wins from either status or error", () => {
    expect(mapToolStatus({ status: "cancelled" })).toBe("cancelled");
    expect(mapToolStatus({ error: "cancelled" })).toBe("cancelled");
  });

  it("timeout wins from either status or error", () => {
    expect(mapToolStatus({ status: "timeout" })).toBe("timeout");
    expect(mapToolStatus({ error: "timeout" })).toBe("timeout");
  });

  it("maps approval_required", () => {
    expect(mapToolStatus({ status: "approval_required" })).toBe("approval_required");
  });

  it("passes through a generic status over the error default", () => {
    // status present + error present → status wins (not "error").
    expect(mapToolStatus({ status: "running", error: true })).toBe("running");
  });

  it("cancelled/timeout precedence beats a generic status", () => {
    // both a special error and a generic status: special wins.
    expect(mapToolStatus({ status: "running", error: "cancelled" })).toBe("cancelled");
    expect(mapToolStatus({ status: "running", error: "timeout" })).toBe("timeout");
  });
});
