import { describe, it, expect } from "vitest";
import { messagePlainText, buildBranchHistory, precedingUserIndex } from "@/lib/branch";
import type { ChatMessage } from "@/lib/hermes-types";

const user = (id: string, content: string): ChatMessage => ({ id, role: "user", content, createdAt: 0 });
const asst = (id: string, segs: ChatMessage["segments"]): ChatMessage => ({
  id, role: "assistant", content: "", segments: segs, createdAt: 0,
});

describe("messagePlainText", () => {
  it("joins text segments and drops tool segments", () => {
    const m = asst("a", [
      { type: "text", content: "thinking" },
      { type: "tool", tc: { id: "t", toolName: "bash", status: "done", result: "x" } },
      { type: "text", content: "answer" },
    ]);
    expect(messagePlainText(m)).toBe("thinking\n\nanswer");
  });

  it("falls back to content when there are no segments", () => {
    expect(messagePlainText(user("u", "  hi  "))).toBe("hi");
  });
});

describe("buildBranchHistory", () => {
  const msgs: ChatMessage[] = [
    user("u0", "q1"),
    asst("a0", [{ type: "text", content: "ans1" }, { type: "tool", tc: { id: "t", toolName: "bash", status: "done" } }]),
    user("u1", "q2"),
    asst("a1", [{ type: "text", content: "ans2" }]),
  ];

  it("keeps user/assistant turns before the cut, tool cards stripped", () => {
    expect(buildBranchHistory(msgs, 2)).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "ans1" }, // tool dropped
    ]);
  });

  it("excludes the message at the cut index (it becomes the new input)", () => {
    // Editing u1 (idx 2): history is everything before it.
    const h = buildBranchHistory(msgs, 2);
    expect(h.map((x) => x.content)).not.toContain("q2");
  });

  it("drops empty messages and returns [] for a non-positive cut", () => {
    expect(buildBranchHistory(msgs, 0)).toEqual([]);
    const withEmpty = [user("u", ""), asst("a", [{ type: "text", content: "hi" }])];
    expect(buildBranchHistory(withEmpty, 2)).toEqual([{ role: "assistant", content: "hi" }]);
  });
});

describe("precedingUserIndex", () => {
  const msgs: ChatMessage[] = [user("u0", "a"), asst("a0", [{ type: "text", content: "b" }]), user("u1", "c"), asst("a1", [{ type: "text", content: "d" }])];

  it("finds the user message that produced an assistant message", () => {
    expect(precedingUserIndex(msgs, 3)).toBe(2); // a1 ← u1
    expect(precedingUserIndex(msgs, 1)).toBe(0); // a0 ← u0
  });

  it("returns -1 when no user precedes", () => {
    expect(precedingUserIndex([asst("a", [{ type: "text", content: "x" }])], 0)).toBe(-1);
  });
});
