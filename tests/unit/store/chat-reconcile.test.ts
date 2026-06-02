// Characterization tests for the chat store's hardest logic: streaming↔DB
// reconciliation, turn-keyed single-bubble routing, and the small state
// transitions the run lifecycle depends on. These pin current behavior so
// the Composer / chat-runtime refactors have a safety net.
//
// They assert what store/chat.ts ACTUALLY does today — not an ideal — so a
// behavior change shows up as a failing test to be reviewed, not a silent drift.

import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "@/store/chat";
import type { ChatMessage } from "@/lib/hermes-types";

function reset() {
  useChatStore.setState({
    messages: [],
    activeRunId: null,
    activeTurnId: null,
    runningBySession: {},
    activeSessionId: null,
    pendingApproval: null,
    isHistoryPending: false,
    lastUsage: null,
  });
}

beforeEach(reset);

// ── Turn-keyed single-bubble routing ────────────────────────────────
// Invariant: with an active turn, every streaming event (delta / tool /
// reasoning) targets the one `turn-<runId>-assistant` bubble.

describe("turn-keyed bubble routing", () => {
  it("routes delta → tool → delta into ONE turn bubble with ordered segments", () => {
    const s = useChatStore.getState();
    s.setActiveTurn("r1");
    s.appendDelta("thinking ");
    s.appendToolCallPart({ id: "t1", toolName: "bash", status: "running" });
    s.appendDelta("done");

    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("turn-r1-assistant");
    const segs = msgs[0].segments ?? [];
    // text "thinking " | tool | new text "done" (delta after a tool opens a fresh text seg)
    expect(segs.map((x) => x.type)).toEqual(["text", "tool", "text"]);
    if (segs[0].type === "text") expect(segs[0].content).toBe("thinking ");
    if (segs[2].type === "text") expect(segs[2].content).toBe("done");
  });

  it("a new active turn opens a separate bubble (one bubble per turn)", () => {
    const s = useChatStore.getState();
    s.setActiveTurn("r1");
    s.appendDelta("first turn");
    // Mark the first bubble non-streaming (as a terminal frame would) so the
    // fallback in findStreamIdx can't reattach to it.
    useChatStore.setState({
      messages: useChatStore.getState().messages.map((m) => ({ ...m, streaming: false })),
    });
    s.setActiveTurn("r2");
    s.appendDelta("second turn");

    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe("turn-r1-assistant");
    expect(msgs[1].id).toBe("turn-r2-assistant");
  });
});

// ── reconcileSession — the crown jewel of reconciliation ─────────────

describe("reconcileSession", () => {
  const dbUser: ChatMessage = { id: "db-user", role: "user", content: "hi", createdAt: 1 };
  const dbAsst: ChatMessage = { id: "db-asst", role: "assistant", content: "hello", createdAt: 2 };

  it("with no active run, replaces transcript wholesale with the DB rebuild", () => {
    useChatStore.setState({
      activeRunId: null,
      messages: [{ id: "stale", role: "user", content: "x", createdAt: 0 }],
      isHistoryPending: true,
    });
    useChatStore.getState().reconcileSession([dbUser, dbAsst]);
    const st = useChatStore.getState();
    expect(st.messages.map((m) => m.id)).toEqual(["db-user", "db-asst"]);
    expect(st.isHistoryPending).toBe(false);
  });

  it("brand-new session (DB empty): keeps the in-flight live user + assistant", () => {
    useChatStore.setState({
      activeRunId: "r1",
      messages: [
        { id: "turn-r1-user", role: "user", content: "do x", createdAt: 1 },
        { id: "turn-r1-assistant", role: "assistant", content: "", createdAt: 2, streaming: true },
      ],
    });
    useChatStore.getState().reconcileSession([]); // DB hasn't persisted yet
    const ids = useChatStore.getState().messages.map((m) => m.id);
    expect(ids).toEqual(["turn-r1-user", "turn-r1-assistant"]);
  });

  it("existing session (DB has a PRIOR turn): keeps the in-flight user + assistant", () => {
    useChatStore.setState({
      activeRunId: "r1",
      messages: [
        { id: "turn-r1-user", role: "user", content: "do x", createdAt: 1 },
        { id: "turn-r1-assistant", role: "assistant", content: "partial", createdAt: 2, streaming: true },
      ],
    });
    // The DB rebuild has a DIFFERENT, prior turn ("hi"/"hello"); the in-flight
    // "do x" isn't persisted yet, so BOTH live bubbles must survive. (Dropping
    // the live user whenever the DB had *any* user was the lost-prompt bug.)
    useChatStore.getState().reconcileSession([dbUser, dbAsst]);
    const ids = useChatStore.getState().messages.map((m) => m.id);
    expect(ids).toEqual(["db-user", "db-asst", "turn-r1-user", "turn-r1-assistant"]);
  });

  it("DB already has THIS turn's user (same content): drops the live user dup", () => {
    useChatStore.setState({
      activeRunId: "r1",
      messages: [
        { id: "turn-r1-user", role: "user", content: "hi", createdAt: 1 },
        { id: "turn-r1-assistant", role: "assistant", content: "partial", createdAt: 2, streaming: true },
      ],
    });
    // The rebuild's last user IS this turn's prompt ("hi") → drop the live dup,
    // keep the still-streaming assistant.
    useChatStore.getState().reconcileSession([dbUser, dbAsst]);
    const ids = useChatStore.getState().messages.map((m) => m.id);
    expect(ids).toEqual(["db-user", "db-asst", "turn-r1-assistant"]);
  });

  it("active run but no live turn bubbles: just the DB rebuild", () => {
    useChatStore.setState({ activeRunId: "r1", messages: [] });
    useChatStore.getState().reconcileSession([dbUser]);
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(["db-user"]);
  });
});

// ── upsertToolCall patch-merge (must not blank preview/result) ────────

describe("upsertToolCall patch-merge", () => {
  it("a status-only completion preserves the earlier preview", () => {
    const s = useChatStore.getState();
    s.setActiveTurn("r1");
    s.appendToolCallPart({ id: "t1", toolName: "terminal", preview: "ls -la", status: "running" });
    // tool.completed often carries only id + status — must not wipe preview.
    s.upsertToolCall({ id: "t1", toolName: "terminal", status: "done" });

    const segs = useChatStore.getState().messages[0].segments ?? [];
    const tool = segs.find((x) => x.type === "tool");
    expect(tool?.type).toBe("tool");
    if (tool?.type === "tool") {
      expect(tool.tc.status).toBe("done");
      expect(tool.tc.preview).toBe("ls -la"); // preserved
    }
  });

  it("upsert for an unknown id is a no-op (no phantom tool card)", () => {
    const s = useChatStore.getState();
    s.setActiveTurn("r1");
    s.appendToolCallPart({ id: "t1", toolName: "bash", status: "running" });
    s.upsertToolCall({ id: "does-not-exist", toolName: "bash", status: "done" });
    const segs = useChatStore.getState().messages[0].segments ?? [];
    expect(segs.filter((x) => x.type === "tool")).toHaveLength(1);
  });
});

// ── reasoning stream ─────────────────────────────────────────────────

describe("appendReasoning", () => {
  it("creates the turn bubble if reasoning arrives before any delta, then accumulates", () => {
    const s = useChatStore.getState();
    s.setActiveTurn("r1");
    s.appendReasoning("step 1. ");
    s.appendReasoning("step 2.");
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("turn-r1-assistant");
    expect(msgs[0].reasoning).toBe("step 1. step 2.");
  });
});

// ── run-tracking transitions the lifecycle depends on ────────────────

describe("run/session transitions", () => {
  it("renameMessageId rebinds the optimistic user id to the turn id", () => {
    const s = useChatStore.getState();
    s.appendMessage({ id: "user-pending-abc", role: "user", content: "hi", createdAt: 0 });
    s.renameMessageId("user-pending-abc", "turn-r1-user");
    expect(useChatStore.getState().messages[0].id).toBe("turn-r1-user");
  });

  it("setRunningForSession / clearRunningForSession track at most one run per session", () => {
    const s = useChatStore.getState();
    s.setRunningForSession("s1", "r1");
    expect(useChatStore.getState().runningBySession).toEqual({ s1: "r1" });
    s.clearRunningForSession("s1");
    expect(useChatStore.getState().runningBySession).toEqual({});
    // clearing an absent session is a no-op (no throw, no key churn)
    s.clearRunningForSession("nope");
    expect(useChatStore.getState().runningBySession).toEqual({});
  });

  it("re-selecting the SAME active session does NOT clear messages (the 'content disappears' guard)", () => {
    const s = useChatStore.getState();
    s.setActiveSession("s1");
    s.appendMessage({ id: "m1", role: "user", content: "kept", createdAt: 0 });
    s.setActiveSession("s1"); // same id again
    const st = useChatStore.getState();
    expect(st.messages).toHaveLength(1);
    expect(st.messages[0].id).toBe("m1");
  });

  it("switching to a DIFFERENT session clears messages and marks history pending", () => {
    const s = useChatStore.getState();
    s.setActiveSession("s1");
    s.appendMessage({ id: "m1", role: "user", content: "x", createdAt: 0 });
    s.setActiveSession("s2");
    const st = useChatStore.getState();
    expect(st.messages).toHaveLength(0);
    expect(st.activeSessionId).toBe("s2");
    expect(st.isHistoryPending).toBe(true);
  });

  it("switch to a RUNNING session, then reconcile, keeps the in-flight turn (no content loss)", () => {
    // s2 is mid-run (run r2). The history reconcile lands while the run streams.
    // Invariant the switch path depends on: setActiveSession points activeRunId at
    // the target's own run, so reconcileSession preserves the live turn instead of
    // wiping the prompt + half-streamed answer. (Re-introducing a null activeRunId
    // on switch is exactly the lost-content bug.)
    const s = useChatStore.getState();
    s.setActiveSession("s1");
    useChatStore.setState({ runningBySession: { s2: "r2" } });
    s.setActiveSession("s2");
    expect(useChatStore.getState().activeRunId).toBe("r2");
    expect(useChatStore.getState().activeTurnId).toBe("r2");

    // attachRun seeds the live turn from the transcript:
    useChatStore.setState({
      messages: [
        { id: "turn-r2-user", role: "user", content: "hello", createdAt: 1 },
        {
          id: "turn-r2-assistant", role: "assistant", content: "",
          segments: [{ type: "text", content: "half" }], createdAt: 2, streaming: true,
        },
      ],
    });
    // DB rebuild has no in-flight turn yet (upstream persists on completion).
    useChatStore.getState().reconcileSession([]);
    const ids = useChatStore.getState().messages.map((m) => m.id);
    expect(ids).toEqual(["turn-r2-user", "turn-r2-assistant"]);
  });
});
