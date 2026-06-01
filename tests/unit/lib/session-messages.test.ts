// characterization tests for the DB-row → ChatMessage rebuild
// (historyToChatMessages) + toolResultsById. This transform feeds both the
// /chat history load and the /sessions preview, and is reconciled against the
// live store, so its turn-grouping + tool back-patching is chat-runtime-
// critical. Tests assert what it does TODAY so refactors surface as failures.

import { describe, it, expect } from "vitest";
import { historyToChatMessages } from "@/lib/session-messages";
import { toolResultsById } from "@/lib/load-session";
import type { MessageRow } from "@/lib/session-messages";

function row(p: Partial<MessageRow> & Pick<MessageRow, "id" | "role">): MessageRow {
  return {
    content: null,
    tool_calls: null,
    tool_call_id: null,
    timestamp: 0,
    ...p,
  } as MessageRow;
}

describe("historyToChatMessages", () => {
  it("emits a user bubble then a grouped assistant turn", () => {
    const out = historyToChatMessages([
      row({ id: 1, role: "user", content: "hi", timestamp: 10 }),
      row({ id: 2, role: "assistant", content: "hello", timestamp: 11 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "hist-1", role: "user", content: "hi" });
    // user timestamp is seconds → ms
    expect(out[0].createdAt).toBe(10_000);
    expect(out[1]).toMatchObject({ id: "hist-run-2", role: "assistant", content: "hello" });
    expect(out[1].segments?.map((s) => s.type)).toEqual(["text"]);
  });

  it("groups multiple assistant/tool rows into ONE turn keyed by the first id", () => {
    const out = historyToChatMessages([
      row({ id: 5, role: "assistant", content: "let me check", timestamp: 1,
        tool_calls: [{ id: "call_1", function: { name: "bash" } }] as never }),
      row({ id: 6, role: "tool", tool_call_id: "call_1", content: "ok output", timestamp: 2 }),
      row({ id: 7, role: "assistant", content: "done", timestamp: 3 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("hist-run-5"); // first row's id
    const segs = out[0].segments ?? [];
    expect(segs.map((s) => s.type)).toEqual(["text", "tool", "text"]);
    // text segments joined into content
    expect(out[0].content).toBe("let me check\ndone");
  });

  it("back-patches a tool segment with its result row + infers done", () => {
    const out = historyToChatMessages([
      row({ id: 1, role: "assistant", content: "",
        tool_calls: [{ id: "call_x", function: { name: "read" } }] as never }),
      row({ id: 2, role: "tool", tool_call_id: "call_x", content: "file contents here" }),
    ]);
    const seg = out[0].segments?.find((s) => s.type === "tool") as
      | { type: "tool"; tc: { result?: string; status: string } }
      | undefined;
    expect(seg?.tc.result).toBe("file contents here");
    expect(seg?.tc.status).toBe("done");
  });

  it("infers error status from an error/traceback tool result", () => {
    const out = historyToChatMessages([
      row({ id: 1, role: "assistant", content: "",
        tool_calls: [{ id: "call_e", function: { name: "bash" } }] as never }),
      row({ id: 2, role: "tool", tool_call_id: "call_e", content: "Error: boom" }),
    ]);
    const seg = out[0].segments?.find((s) => s.type === "tool") as
      | { type: "tool"; tc: { status: string } }
      | undefined;
    expect(seg?.tc.status).toBe("error");
  });

  it("starts a fresh turn after an interleaving user message", () => {
    const out = historyToChatMessages([
      row({ id: 1, role: "assistant", content: "a" }),
      row({ id: 2, role: "user", content: "more" }),
      row({ id: 3, role: "assistant", content: "b" }),
    ]);
    expect(out.map((m) => m.id)).toEqual(["hist-run-1", "hist-2", "hist-run-3"]);
  });

  it("returns [] for empty input", () => {
    expect(historyToChatMessages([])).toEqual([]);
  });
});

describe("toolResultsById", () => {
  it("indexes tool rows by tool_call_id", () => {
    const map = toolResultsById([
      row({ id: 1, role: "tool", tool_call_id: "c1", content: "out1" }),
      row({ id: 2, role: "assistant", content: "ignored" }),
      row({ id: 3, role: "tool", tool_call_id: "c2", content: "out2" }),
    ]);
    expect(map).toEqual({ c1: "out1", c2: "out2" });
  });

  it("skips tool rows with no id or empty content", () => {
    const map = toolResultsById([
      row({ id: 1, role: "tool", tool_call_id: null, content: "x" }),
      row({ id: 2, role: "tool", tool_call_id: "c1", content: "" }),
    ]);
    expect(map).toEqual({});
  });
});
