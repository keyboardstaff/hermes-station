// Persistence-adjacent store machinery: approval-notice recording, per-session
// usage, run start times, the in-session edit truncation primitive, and the
// reasoning-segment survival guarantees of stream.reset / run.completed.

import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "@/store/chat";
import type { ChatMessage } from "@/lib/hermes-types";

const user = (id: string): ChatMessage => ({ id, role: "user", content: id, createdAt: 0 });
const asst = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role: "assistant", content: "", createdAt: 0, ...over,
});

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    activeSessionId: null,
    activeTurnId: null,
    approvalNotices: {},
    usageBySession: {},
    runStartedAt: {},
  });
});

describe("appendApprovalNoticeSegment persistence", () => {
  it("appends the segment AND records {ord, choice, command} for the session", () => {
    useChatStore.setState({
      activeSessionId: "s1",
      messages: [user("u0"), asst("a0", { segments: [{ type: "text", content: "hi" }] }),
        user("u1"), asst("a1", { segments: [{ type: "text", content: "yo" }] })],
    });
    useChatStore.getState().appendApprovalNoticeSegment("session", "rm -rf /tmp/x");

    const s = useChatStore.getState();
    const segs = s.messages[3].segments ?? [];
    expect(segs[segs.length - 1]).toEqual({
      type: "approval_notice", choice: "session", command: "rm -rf /tmp/x",
    });
    // Recorded against the SECOND user turn (ord 1).
    expect(s.approvalNotices["s1"]).toEqual([
      { ord: 1, choice: "session", command: "rm -rf /tmp/x" },
    ]);
  });

  it("appends the segment without recording when no session is active", () => {
    useChatStore.setState({
      activeSessionId: null,
      messages: [user("u0"), asst("a0", { segments: [] })],
    });
    useChatStore.getState().appendApprovalNoticeSegment("deny", "curl evil");
    const s = useChatStore.getState();
    expect(s.messages[1].segments?.at(-1)?.type).toBe("approval_notice");
    expect(s.approvalNotices).toEqual({});
  });
});

describe("setUsageForSession / setRunStartedAt", () => {
  it("stores usage per session and bounds the map to 60 entries", () => {
    const set = useChatStore.getState().setUsageForSession;
    for (let i = 0; i < 65; i++) {
      set(`s${i}`, { input_tokens: i, output_tokens: 0, total_tokens: i });
    }
    const map = useChatStore.getState().usageBySession;
    expect(Object.keys(map)).toHaveLength(60);
    expect(map["s0"]).toBeUndefined(); // oldest evicted
    expect(map["s64"]?.total_tokens).toBe(64);
  });

  it("records run start times", () => {
    useChatStore.getState().setRunStartedAt("run-1", 1234500000);
    expect(useChatStore.getState().runStartedAt["run-1"]).toBe(1234500000);
  });
});

describe("truncateMessagesBefore", () => {
  it("drops the message at index and everything after", () => {
    useChatStore.setState({ messages: [user("u0"), asst("a0"), user("u1"), asst("a1")] });
    useChatStore.getState().truncateMessagesBefore(2);
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(["u0", "a0"]);
  });

  it("no-ops for out-of-range indices", () => {
    const msgs = [user("u0")];
    useChatStore.setState({ messages: msgs });
    useChatStore.getState().truncateMessagesBefore(-1);
    useChatStore.getState().truncateMessagesBefore(5);
    expect(useChatStore.getState().messages).toHaveLength(1);
  });
});

describe("reasoning segments survive stream lifecycle reductions", () => {
  function seedStreamingTurn() {
    useChatStore.setState({ activeTurnId: "r1", messages: [] });
    const s = useChatStore.getState();
    s.appendReasoning("let me think");
    s.appendDelta("draft answer");
    s.appendToolCallPart({ id: "t1", toolName: "terminal", status: "running" });
  }

  it("clearStreamingContent drops text but keeps reasoning + tool segments", () => {
    seedStreamingTurn();
    useChatStore.getState().clearStreamingContent();
    const segs = useChatStore.getState().messages[0].segments ?? [];
    expect(segs.map((x) => x.type)).toEqual(["reasoning", "tool"]);
  });

  it("setFinalContent keeps reasoning + tool and appends the final text last", () => {
    seedStreamingTurn();
    useChatStore.getState().setFinalContent("the real answer");
    const segs = useChatStore.getState().messages[0].segments ?? [];
    expect(segs.map((x) => x.type)).toEqual(["reasoning", "tool", "text"]);
    const last = segs[segs.length - 1];
    expect(last.type === "text" && last.content).toBe("the real answer");
  });
});
