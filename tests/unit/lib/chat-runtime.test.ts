import { describe, it, expect } from "vitest";
import { toThreadMessage, messageText, APPROVAL_NOTICE_TOOL } from "@/lib/chat-runtime";
import type { ChatMessage, ToolCall } from "@/lib/hermes-types";

const tc = (over: Partial<ToolCall> = {}): ToolCall => ({
  id: "t1",
  toolName: "shell",
  status: "done",
  ...over,
});

describe("messageText", () => {
  it("joins text segments and ignores tool/approval segments", () => {
    const msg: ChatMessage = {
      id: "m1",
      role: "assistant",
      content: "ignored",
      segments: [
        { type: "text", content: "hello" },
        { type: "tool", tc: tc() },
        { type: "text", content: "world" },
      ],
      createdAt: 0,
    };
    expect(messageText(msg)).toBe("hello\nworld");
  });

  it("falls back to content when there are no segments", () => {
    const msg: ChatMessage = { id: "m1", role: "assistant", content: "plain", createdAt: 0 };
    expect(messageText(msg)).toBe("plain");
  });
});

describe("toThreadMessage", () => {
  it("keeps a user turn as a single text part and carries hms", () => {
    const msg: ChatMessage = { id: "u1", role: "user", content: "hi there", createdAt: 5 };
    const out = toThreadMessage(msg);
    expect(out.role).toBe("user");
    expect(out.content).toEqual([{ type: "text", text: "hi there" }]);
    expect((out.metadata?.custom as { hms: ChatMessage }).hms).toBe(msg);
  });

  it("converts assistant segments to ordered native parts (reasoning first)", () => {
    const toolCall = tc({ id: "t9", toolName: "search", preview: "q", result: "r", status: "done" });
    const msg: ChatMessage = {
      id: "a1",
      role: "assistant",
      content: "",
      reasoning: "thinking",
      segments: [
        { type: "text", content: "before" },
        { type: "tool", tc: toolCall },
        { type: "approval_notice", choice: "session", command: "rm -rf" },
        { type: "text", content: "" }, // empty text dropped
        { type: "text", content: "after" },
      ],
      createdAt: 0,
    };
    const out = toThreadMessage(msg);
    expect(out.role).toBe("assistant");
    const parts = out.content as ReadonlyArray<Record<string, unknown>>;
    expect(parts.map((p) => p.type)).toEqual([
      "reasoning",
      "text",
      "tool-call",
      "tool-call",
      "text",
    ]);
    // reasoning carries the trace
    expect(parts[0]).toMatchObject({ type: "reasoning", text: "thinking" });
    // the real tool round-trips the full ToolCall through args
    expect(parts[2]).toMatchObject({ type: "tool-call", toolName: "search" });
    expect(parts[2].args).toMatchObject({ id: "t9", result: "r", status: "done" });
    // approval notice rides the sentinel tool channel
    expect(parts[3]).toMatchObject({ type: "tool-call", toolName: APPROVAL_NOTICE_TOOL });
    expect(parts[3].args).toEqual({ choice: "session", command: "rm -rf" });
    // text parts preserve order and drop the empty one
    expect(parts[1]).toMatchObject({ type: "text", text: "before" });
    expect(parts[4]).toMatchObject({ type: "text", text: "after" });
  });

  it("emits a single empty text part when an assistant turn has no body", () => {
    const msg: ChatMessage = { id: "a2", role: "assistant", content: "", createdAt: 0 };
    const out = toThreadMessage(msg);
    expect(out.content).toEqual([{ type: "text", text: "" }]);
  });

  it("falls back to content when an assistant turn has no segments", () => {
    const msg: ChatMessage = { id: "a3", role: "assistant", content: "answer", createdAt: 0 };
    const out = toThreadMessage(msg);
    expect(out.content).toEqual([{ type: "text", text: "answer" }]);
  });
});
