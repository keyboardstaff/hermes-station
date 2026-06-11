import { describe, it, expect } from "vitest";
import { messagePlainText, buildBranchHistory, precedingUserIndex, userOrdinal, editTarget } from "@/lib/branch";
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

describe("userOrdinal", () => {
  const msgs: ChatMessage[] = [
    user("u0", "a"),
    asst("a0", [{ type: "text", content: "b" }]),
    user("u1", "c"),
    asst("a1", [{ type: "text", content: "d" }]),
    user("u2", "e"),
  ];

  it("counts user turns before the target (matches the server's user_indices)", () => {
    expect(userOrdinal(msgs, 0)).toBe(0); // first user turn → truncate to empty
    expect(userOrdinal(msgs, 2)).toBe(1); // second user turn
    expect(userOrdinal(msgs, 4)).toBe(2); // third user turn
  });

  it("skips hidden messages — state.db holds only the active path", () => {
    const withHidden: ChatMessage[] = [
      { ...user("u0", "a"), hidden: true },
      user("u1", "b"),
      user("u2", "c"),
    ];
    expect(userOrdinal(withHidden, 2)).toBe(1); // u0 hidden → u2 is the 2nd visible
  });
});

describe("editTarget", () => {
  const msgs: ChatMessage[] = [
    user("u0", "a"),
    asst("a0", [{ type: "text", content: "b" }]),
    user("u1", "c"),
    asst("a1", [{ type: "text", content: "d" }]),
  ];

  it("resolves a user message id to its index + truncate ordinal", () => {
    expect(editTarget(msgs, "u1")).toEqual({ index: 2, ordinal: 1 });
    expect(editTarget(msgs, "u0")).toEqual({ index: 0, ordinal: 0 });
  });

  it("rejects unknown ids, assistant messages and null", () => {
    expect(editTarget(msgs, "nope")).toBeNull();
    expect(editTarget(msgs, "a0")).toBeNull();
    expect(editTarget(msgs, null)).toBeNull();
  });
});
