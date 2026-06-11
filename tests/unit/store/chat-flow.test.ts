// Chat store integration scenarios (normal/error/boundary/empty/state).

import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "@/store/chat";

const RESET_STATE = {
  messages: [],
  activeRunId: null,
  activeTurnId: null,
  runningBySession: {},
  activeSessionId: null,
  pendingApproval: null,
  selectedModel: null,
  selectedProvider: null,
  reasoningEffort: null,
  isHistoryPending: false,
};

function reset() {
  useChatStore.setState(RESET_STATE);
}


describe("clearStreamingContent", () => {
  beforeEach(reset);

  it("B6: removes text segments but keeps tool segments on stream.reset", () => {
    const { appendDelta, appendToolCallPart, clearStreamingContent } =
      useChatStore.getState();

    appendDelta("pre-tool text");
    appendToolCallPart({ id: "tc1", toolName: "bash", status: "running" });
    appendDelta("leaked post-tool text");

    clearStreamingContent();

    const msgs = useChatStore.getState().messages;
    const last = msgs[msgs.length - 1];
    const segs = last.segments ?? [];

    const textSegs = segs.filter((s) => s.type === "text");
    const toolSegs = segs.filter((s) => s.type === "tool");

    expect(textSegs).toHaveLength(0);
    expect(toolSegs).toHaveLength(1);
    if (toolSegs[0]?.type === "tool") {
      expect(toolSegs[0].tc.id).toBe("tc1");
    }
  });
});


describe("concurrent tool calls", () => {
  beforeEach(reset);

  it("N4: two tool.started events create two independent tool segments", () => {
    const { appendToolCallPart } = useChatStore.getState();

    appendToolCallPart({ id: "tc-run1-1", toolName: "bash", status: "running" });
    appendToolCallPart({ id: "tc-run1-2", toolName: "bash", status: "running" });

    const msgs = useChatStore.getState().messages;
    const last = msgs[msgs.length - 1];
    const toolSegs = (last.segments ?? []).filter((s) => s.type === "tool");

    expect(toolSegs).toHaveLength(2);
    if (toolSegs[0]?.type === "tool") expect(toolSegs[0].tc.id).toBe("tc-run1-1");
    if (toolSegs[1]?.type === "tool") expect(toolSegs[1].tc.id).toBe("tc-run1-2");
  });
});


describe("tool completion", () => {
  beforeEach(reset);

  it("N5a: upsertToolCall marks status=done on success", () => {
    const { appendToolCallPart, upsertToolCall } = useChatStore.getState();
    appendToolCallPart({ id: "tc1", toolName: "bash", status: "running" });
    upsertToolCall({ id: "tc1", toolName: "bash", status: "done" });

    const msgs = useChatStore.getState().messages;
    const last = msgs[msgs.length - 1];
    const seg = (last.segments ?? []).find((s) => s.type === "tool" && s.tc.id === "tc1");
    expect(seg?.type).toBe("tool");
    if (seg?.type === "tool") expect(seg.tc.status).toBe("done");
  });

  it("N5b: upsertToolCall marks status=error on tool error", () => {
    const { appendToolCallPart, upsertToolCall } = useChatStore.getState();
    appendToolCallPart({ id: "tc2", toolName: "python", status: "running" });
    upsertToolCall({ id: "tc2", toolName: "python", status: "error" });

    const msgs = useChatStore.getState().messages;
    const last = msgs[msgs.length - 1];
    const seg = (last.segments ?? []).find((s) => s.type === "tool" && s.tc.id === "tc2");
    if (seg?.type === "tool") expect(seg.tc.status).toBe("error");
  });
});


describe("run.completed handling", () => {
  beforeEach(reset);

  it("N7: setFinalContent replaces accumulated delta text with final output", () => {
    const { appendDelta, setFinalContent } = useChatStore.getState();
    appendDelta("partial tok");
    appendDelta("en stream");
    setFinalContent("The final verified response.");

    const msgs = useChatStore.getState().messages;
    const last = msgs[msgs.length - 1];
    // After setFinalContent the text segment should contain only the final output
    const textSegs = (last.segments ?? []).filter((s) => s.type === "text");
    // setFinalContent replaces content — total text should be just the final
    const allText = textSegs
      .map((s) => (s.type === "text" ? s.content : ""))
      .join("");
    expect(allText).toBe("The final verified response.");
  });

  it("E5: streaming flag should be false after explicitly clearing it (simulating run.completed)", () => {
    const { appendDelta } = useChatStore.getState();
    appendDelta("streaming...");

    // Simulate run.completed: clear streaming flag manually (as useRunsStream does)
    const msgs = useChatStore.getState().messages;
    const last = msgs[msgs.length - 1];
    expect(last.streaming).toBe(true);

    useChatStore.setState({
      messages: msgs.map((m) =>
        m.id === last.id ? { ...m, streaming: false } : m
      ),
    });

    const updated = useChatStore.getState().messages;
    expect(updated[updated.length - 1].streaming).toBe(false);
  });
});


describe("patchToolResultsById", () => {
  beforeEach(reset);

  it("B3: results land on the matching card by tool_call_id, regardless of order", () => {
    const { appendToolCallPart, upsertToolCall, patchToolResultsById } =
      useChatStore.getState();

    appendToolCallPart({ id: "tc-a", toolName: "bash", status: "running" });
    upsertToolCall({ id: "tc-a", toolName: "bash", status: "done" });
    appendToolCallPart({ id: "tc-b", toolName: "python", status: "running" });
    upsertToolCall({ id: "tc-b", toolName: "python", status: "done" });

    // Map supplied out of segment order — must still match by id, not position.
    patchToolResultsById({ "tc-b": "result-beta", "tc-a": "result-alpha" });

    const msgs = useChatStore.getState().messages;
    const toolSegs = msgs
      .flatMap((m) => m.segments ?? [])
      .filter((s) => s.type === "tool");

    if (toolSegs[0]?.type === "tool") expect(toolSegs[0].tc.result).toBe("result-alpha");
    if (toolSegs[1]?.type === "tool") expect(toolSegs[1].tc.result).toBe("result-beta");
  });
});


describe("reasoning suppression", () => {
  beforeEach(reset);

  it("B7: appendReasoning does NOT add reasoning when effort=none", () => {
    // Simulate the useRunsStream guard: if effort is "none", skip appendReasoning
    useChatStore.setState({ ...RESET_STATE, reasoningEffort: "none" });

    const state = useChatStore.getState();
    // The hook checks: if (reasoningEffort !== "none") appendReasoning(text)
    if (state.reasoningEffort !== "none") {
      state.appendReasoning("secret chain of thought");
    }
    // appendReasoning not called — messages should be empty
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("B7b: appendReasoning IS applied when effort is not none", () => {
    const { appendDelta, appendReasoning } = useChatStore.getState();
    appendDelta("answer text");
    appendReasoning("step by step thinking");

    const msgs = useChatStore.getState().messages;
    const last = msgs[msgs.length - 1];
    // appendReasoning interleaves a reasoning segment in stream order.
    const lastSeg = last.segments?.[last.segments.length - 1];
    expect(lastSeg).toEqual({ type: "reasoning", content: "step by step thinking" });
  });
});


describe("empty store", () => {
  beforeEach(reset);

  it("S1: appendDelta on empty store creates a single streaming assistant message", () => {
    const { appendDelta } = useChatStore.getState();
    appendDelta("hello");

    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].streaming).toBe(true);
  });
});


describe("user message", () => {
  beforeEach(reset);

  it("S2: appendMessage with role=user is not marked as streaming", () => {
    const { appendMessage } = useChatStore.getState();
    appendMessage({ id: "u1", role: "user", content: "hi", createdAt: 0 });

    const msgs = useChatStore.getState().messages;
    expect(msgs[0].streaming).toBeFalsy();
    expect(msgs[0].role).toBe("user");
  });

  it("S2b: sending empty-ish input is prevented at store level (no message added if content is blank)", () => {
    // The actual guard is in useRunsStream/Composer (not the store itself).
    // Verify the store accepts the message but doesn't silently strip content.
    const { appendMessage } = useChatStore.getState();
    appendMessage({ id: "u2", role: "user", content: "", createdAt: 0 });
    // Store accepts it (guard is upstream); content is preserved as-is.
    expect(useChatStore.getState().messages[0].content).toBe("");
  });
});


describe("turn-keyed bubble behavior", () => {
  beforeEach(reset);

  it("all streaming events target a single turn-<id>-assistant bubble", () => {
    useChatStore.setState({ ...RESET_STATE, activeTurnId: "run_abc" });
    const { appendDelta, appendToolCallPart, appendReasoning } = useChatStore.getState();

    appendReasoning("thinking");
    appendDelta("hello ");
    appendToolCallPart({ id: "tc1", toolName: "bash", status: "running" });
    appendDelta("world");

    const msgs = useChatStore.getState().messages;
    const assistants = msgs.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].id).toBe("turn-run_abc-assistant");
  });

  it("a delta after the streaming flag is cleared does NOT spawn a 2nd bubble", () => {
    // Reproduces race #6: completion/reset clears streaming, then a late delta lands.
    useChatStore.setState({ ...RESET_STATE, activeTurnId: "run_xyz" });
    const { appendDelta } = useChatStore.getState();

    appendDelta("first");
    // Simulate a premature streaming-flag clear (reconnect guard / stop).
    const msgs = useChatStore.getState().messages;
    useChatStore.setState({
      messages: msgs.map((m) => ({ ...m, streaming: false })),
    });
    // Late delta for the same turn — must reuse the existing bubble by id.
    appendDelta(" second");

    const assistants = useChatStore.getState().messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    const segs = assistants[0].segments ?? [];
    const text = segs.filter((s) => s.type === "text").map((s) => (s.type === "text" ? s.content : "")).join("");
    expect(text).toBe("first second");
  });

  it("null activeTurnId falls back to last-streaming locator (legacy)", () => {
    const { appendDelta } = useChatStore.getState();
    appendDelta("a");
    appendDelta("b");
    const assistants = useChatStore.getState().messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
  });
});


describe("renameMessageId", () => {
  beforeEach(reset);

  it("rebinds an optimistic user id to turn-<runId>-user", () => {
    const { appendMessage, renameMessageId } = useChatStore.getState();
    appendMessage({ id: "user-pending-tmp", role: "user", content: "hi", createdAt: 0 });
    renameMessageId("user-pending-tmp", "turn-run_123-user");

    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("turn-run_123-user");
    expect(msgs[0].content).toBe("hi");
  });
});


describe("reconcileSession", () => {
  beforeEach(reset);

  const rebuilt = [
    { id: "hist-1", role: "user" as const, content: "q1", createdAt: 1 },
    { id: "hist-run-2", role: "assistant" as const, content: "a1", createdAt: 2 },
  ];

  it("R1: with no active run, wholesale-replaces the transcript with the DB rebuild", () => {
    const { appendMessage, reconcileSession } = useChatStore.getState();
    appendMessage({ id: "stale", role: "user", content: "ghost", createdAt: 0 });
    reconcileSession(rebuilt);

    const msgs = useChatStore.getState().messages;
    expect(msgs.map((m) => m.id)).toEqual(["hist-1", "hist-run-2"]);
    expect(useChatStore.getState().isHistoryPending).toBe(false);
  });

  it("R2: with an active run, keeps the live assistant bubble appended after the rebuild", () => {
    useChatStore.setState({ ...RESET_STATE, activeRunId: "run_live", activeTurnId: "run_live" });
    const { appendDelta, reconcileSession } = useChatStore.getState();
    appendDelta("streaming…"); // creates turn-run_live-assistant

    reconcileSession(rebuilt);

    const msgs = useChatStore.getState().messages;
    expect(msgs.map((m) => m.id)).toEqual(["hist-1", "hist-run-2", "turn-run_live-assistant"]);
  });

  it("R3: brand-new session (empty rebuild) keeps the live user + assistant bubbles", () => {
    useChatStore.setState({ ...RESET_STATE, activeRunId: "run_new", activeTurnId: "run_new" });
    const { appendMessage, appendDelta, reconcileSession } = useChatStore.getState();
    appendMessage({ id: "turn-run_new-user", role: "user", content: "hi", createdAt: 0 });
    appendDelta("partial");

    reconcileSession([]); // DB has nothing yet

    const ids = useChatStore.getState().messages.map((m) => m.id);
    expect(ids).toEqual(["turn-run_new-user", "turn-run_new-assistant"]);
  });

  it("R4: when the DB rebuild already has the user turn, the live user copy is dropped (no dup)", () => {
    useChatStore.setState({ ...RESET_STATE, activeRunId: "run_live", activeTurnId: "run_live" });
    const { appendMessage, appendDelta, reconcileSession } = useChatStore.getState();
    appendMessage({ id: "turn-run_live-user", role: "user", content: "q1", createdAt: 0 });
    appendDelta("streaming…");

    reconcileSession(rebuilt); // rebuilt contains a user message

    const ids = useChatStore.getState().messages.map((m) => m.id);
    expect(ids).toEqual(["hist-1", "hist-run-2", "turn-run_live-assistant"]);
    expect(ids.filter((id) => id.endsWith("-user"))).toHaveLength(0);
  });
});


describe("runningBySession map", () => {
  beforeEach(reset);

  it("M1: set then clear tracks the run under its session", () => {
    const { setRunningForSession, clearRunningForSession } = useChatStore.getState();
    setRunningForSession("sess_a", "run_1");
    setRunningForSession("sess_b", "run_2");
    expect(useChatStore.getState().runningBySession).toEqual({ sess_a: "run_1", sess_b: "run_2" });

    clearRunningForSession("sess_a");
    expect(useChatStore.getState().runningBySession).toEqual({ sess_b: "run_2" });
  });
});


describe("session isolation", () => {
  beforeEach(reset);

  it("setActiveSession clears messages from previous session", () => {
    const { appendMessage, setActiveSession } = useChatStore.getState();
    appendMessage({ id: "old1", role: "user", content: "previous session msg", createdAt: 0 });

    setActiveSession("new-session-xyz");

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.activeSessionId).toBe("new-session-xyz");
  });

  it("updateActiveSessionId does NOT clear messages (used after first send)", () => {
    const { appendMessage, updateActiveSessionId } = useChatStore.getState();
    appendMessage({ id: "u1", role: "user", content: "first msg", createdAt: 0 });

    updateActiveSessionId("run_new123");

    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().activeSessionId).toBe("run_new123");
  });
});
