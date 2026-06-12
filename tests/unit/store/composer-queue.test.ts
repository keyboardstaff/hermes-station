// Composer queue semantics (desktop parity): per-session FIFO with promote /
// edit-in-place, localStorage persistence, and the settle auto-drain rule.

import { describe, it, expect, beforeEach } from "vitest";
import {
  useComposerQueue,
  queuedPromptsFor,
  shouldAutoDrainOnSettle,
} from "@/store/composer-queue";
import type { ComposerAttachment } from "@/lib/hermes-types";

const att = (id: string): ComposerAttachment => ({
  id, name: `${id}.png`, mimeType: "image/png", content: `/api/upload/${id}.png`, isImage: true,
});

const queueOf = (sid: string) =>
  queuedPromptsFor(useComposerQueue.getState().queuesBySession, sid);

beforeEach(() => {
  window.localStorage.clear();
  useComposerQueue.setState({ queuesBySession: {} });
});

describe("enqueue", () => {
  it("appends per session in FIFO order and returns the entry", () => {
    const a = useComposerQueue.getState().enqueue("s1", { text: "first" });
    const b = useComposerQueue.getState().enqueue("s1", { text: "second" });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(queueOf("s1").map((e) => e.text)).toEqual(["first", "second"]);
  });

  it("clones attachments onto the entry", () => {
    const source = att("img1");
    useComposerQueue.getState().enqueue("s1", { text: "with file", attachments: [source] });
    const stored = queueOf("s1")[0].attachments[0];
    expect(stored).toEqual(source);
    expect(stored).not.toBe(source);
  });

  it("rejects a missing/blank session key", () => {
    expect(useComposerQueue.getState().enqueue(null, { text: "x" })).toBeNull();
    expect(useComposerQueue.getState().enqueue("  ", { text: "x" })).toBeNull();
    expect(useComposerQueue.getState().queuesBySession).toEqual({});
  });

  it("isolates sessions from each other", () => {
    useComposerQueue.getState().enqueue("s1", { text: "one" });
    useComposerQueue.getState().enqueue("s2", { text: "two" });
    expect(queueOf("s1").map((e) => e.text)).toEqual(["one"]);
    expect(queueOf("s2").map((e) => e.text)).toEqual(["two"]);
  });
});

describe("remove / clear", () => {
  it("removes by id and drops the session bucket when emptied", () => {
    const entry = useComposerQueue.getState().enqueue("s1", { text: "bye" })!;
    expect(useComposerQueue.getState().remove("s1", entry.id)).toBe(true);
    expect("s1" in useComposerQueue.getState().queuesBySession).toBe(false);
  });

  it("returns false for an unknown id", () => {
    useComposerQueue.getState().enqueue("s1", { text: "stay" });
    expect(useComposerQueue.getState().remove("s1", "nope")).toBe(false);
    expect(queueOf("s1")).toHaveLength(1);
  });

  it("clear empties only the targeted session", () => {
    useComposerQueue.getState().enqueue("s1", { text: "a" });
    useComposerQueue.getState().enqueue("s2", { text: "b" });
    useComposerQueue.getState().clear("s1");
    expect(queueOf("s1")).toHaveLength(0);
    expect(queueOf("s2")).toHaveLength(1);
  });
});

describe("promote", () => {
  it("moves the entry to the head (the next drain sends it)", () => {
    useComposerQueue.getState().enqueue("s1", { text: "a" });
    useComposerQueue.getState().enqueue("s1", { text: "b" });
    const c = useComposerQueue.getState().enqueue("s1", { text: "c" })!;
    expect(useComposerQueue.getState().promote("s1", c.id)).toBe(true);
    expect(queueOf("s1").map((e) => e.text)).toEqual(["c", "a", "b"]);
  });

  it("is a no-op for the head or an unknown id", () => {
    const a = useComposerQueue.getState().enqueue("s1", { text: "a" })!;
    expect(useComposerQueue.getState().promote("s1", a.id)).toBe(false);
    expect(useComposerQueue.getState().promote("s1", "nope")).toBe(false);
  });
});

describe("updateText", () => {
  it("rewrites only the targeted entry", () => {
    const a = useComposerQueue.getState().enqueue("s1", { text: "a" })!;
    useComposerQueue.getState().enqueue("s1", { text: "b" });
    expect(useComposerQueue.getState().updateText("s1", a.id, "a2")).toBe(true);
    expect(queueOf("s1").map((e) => e.text)).toEqual(["a2", "b"]);
  });

  it("returns false when nothing changes", () => {
    const a = useComposerQueue.getState().enqueue("s1", { text: "same" })!;
    expect(useComposerQueue.getState().updateText("s1", a.id, "same")).toBe(false);
    expect(useComposerQueue.getState().updateText("s1", "nope", "x")).toBe(false);
  });
});

describe("persistence", () => {
  it("writes the queue to localStorage under hms-composer-queue", () => {
    useComposerQueue.getState().enqueue("s1", { text: "survive me" });
    const raw = window.localStorage.getItem("hms-composer-queue");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.queuesBySession.s1[0].text).toBe("survive me");
  });
});

describe("shouldAutoDrainOnSettle", () => {
  it("drains only on a busy true→false edge with a non-empty queue", () => {
    expect(shouldAutoDrainOnSettle({ wasBusy: true, isBusy: false, queueLength: 2 })).toBe(true);
    expect(shouldAutoDrainOnSettle({ wasBusy: true, isBusy: false, queueLength: 0 })).toBe(false);
    expect(shouldAutoDrainOnSettle({ wasBusy: true, isBusy: true, queueLength: 2 })).toBe(false);
    expect(shouldAutoDrainOnSettle({ wasBusy: false, isBusy: false, queueLength: 2 })).toBe(false);
    expect(shouldAutoDrainOnSettle({ wasBusy: false, isBusy: true, queueLength: 2 })).toBe(false);
  });
});
