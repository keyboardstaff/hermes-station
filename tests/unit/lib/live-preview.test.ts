import { describe, it, expect } from "vitest";
import {
  emptyAccumulator, applyDelta, addTool, patchTool, buildLiveTurn,
} from "@/lib/live-preview";
import type { MessageSegment } from "@/lib/hermes-types";

// The Sessions preview's live mirror reuses these pure reducers; they must
// match the chat store's segment routing so the drawer and /chat render the
// same text/tool ordering (just into local state instead of the global store).

describe("applyDelta", () => {
  it("extends a trailing text segment", () => {
    let segs: MessageSegment[] = [];
    segs = applyDelta(segs, "Hello");
    segs = applyDelta(segs, " world");
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ type: "text", content: "Hello world" });
  });

  it("opens a NEW text segment after a tool segment (preserves ordering)", () => {
    let segs: MessageSegment[] = [{ type: "text", content: "before" }];
    segs = addTool(segs, { id: "t1", toolName: "bash", status: "running" });
    segs = applyDelta(segs, "after");
    expect(segs.map((s) => s.type)).toEqual(["text", "tool", "text"]);
    if (segs[2].type === "text") expect(segs[2].content).toBe("after");
  });
});

describe("addTool", () => {
  it("appends a tool segment", () => {
    const segs = addTool([], { id: "t1", toolName: "bash", status: "running" });
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe("tool");
  });

  it("is idempotent on a duplicate id (ring replay safety)", () => {
    let segs = addTool([], { id: "t1", toolName: "bash", status: "running" });
    segs = addTool(segs, { id: "t1", toolName: "bash", status: "running" });
    expect(segs.filter((s) => s.type === "tool")).toHaveLength(1);
  });
});

describe("patchTool", () => {
  it("patches status + duration by id, preserving preview", () => {
    let segs = addTool([], { id: "t1", toolName: "bash", preview: "ls -la", status: "running" });
    segs = patchTool(segs, "t1", "done", 42);
    const tool = segs.find((s) => s.type === "tool");
    expect(tool?.type).toBe("tool");
    if (tool?.type === "tool") {
      expect(tool.tc.status).toBe("done");
      expect(tool.tc.duration).toBe(42);
      expect(tool.tc.preview).toBe("ls -la");
    }
  });

  it("keeps the prior duration when the completion omits it", () => {
    let segs = addTool([], { id: "t1", toolName: "bash", duration: 7, status: "running" });
    segs = patchTool(segs, "t1", "done", undefined);
    const tool = segs.find((s) => s.type === "tool");
    if (tool?.type === "tool") expect(tool.tc.duration).toBe(7);
  });

  it("is a no-op for an unknown id (no phantom card)", () => {
    const segs = addTool([], { id: "t1", toolName: "bash", status: "running" });
    const patched = patchTool(segs, "nope", "done", 1);
    expect(patched).toEqual(segs);
  });
});

describe("buildLiveTurn", () => {
  it("emits stable-id user + assistant bubbles for an in-flight turn", () => {
    const acc = emptyAccumulator();
    acc.userInput = "do x";
    acc.segments = applyDelta(acc.segments, "working");
    const out = buildLiveTurn("r1", 1000, acc);
    expect(out.map((m) => m.id)).toEqual(["live-r1-user", "live-r1-assistant"]);
    expect(out[1].streaming).toBe(true);
    expect(out[1].segments?.[0]).toEqual({ type: "text", content: "working" });
  });

  it("omits the assistant bubble until there's content", () => {
    const acc = emptyAccumulator();
    acc.userInput = "do x";
    const out = buildLiveTurn("r1", 1000, acc);
    expect(out.map((m) => m.id)).toEqual(["live-r1-user"]);
  });

  it("surfaces reasoning even with no text/tool segments yet", () => {
    const acc = emptyAccumulator();
    acc.reasoning = "thinking…";
    const out = buildLiveTurn("r1", 1000, acc);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("live-r1-assistant");
    expect(out[0].segments?.[0]).toEqual({ type: "reasoning", content: "thinking…" });
  });

  it("snapshots segments (later mutation of the accumulator doesn't leak in)", () => {
    const acc = emptyAccumulator();
    acc.segments = applyDelta(acc.segments, "v1");
    const out = buildLiveTurn("r1", 1000, acc);
    acc.segments = applyDelta(acc.segments, " v2");
    // The already-built bubble must not see the later append.
    const seg = out[0].segments?.[0];
    if (seg?.type === "text") expect(seg.content).toBe("v1");
  });
});
