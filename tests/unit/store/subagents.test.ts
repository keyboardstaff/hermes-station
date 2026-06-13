// Subagent observability store: upsert from relayed subagent.* payloads,
// stream coalescing, terminal-status lock, and tree assembly.

import { describe, it, expect, beforeEach } from "vitest";
import {
  useSubagents, buildSubagentTree, activeSubagentCount,
  type SubagentProgress,
} from "@/store/subagents";

beforeEach(() => {
  useSubagents.setState({ bySession: {} });
});

const list = (sid: string) => useSubagents.getState().bySession[sid] ?? [];

describe("upsert", () => {
  it("creates a record from a start event and reads identity fields", () => {
    useSubagents.getState().upsert(
      "s1",
      { subagent_id: "a1", goal: "Refactor X", status: "running", model: "opus" },
      true,
      "subagent.start",
    );
    const rec = list("s1")[0];
    expect(rec.id).toBe("a1");
    expect(rec.goal).toBe("Refactor X");
    expect(rec.status).toBe("running");
    expect(rec.model).toBe("opus");
  });

  it("does not create on a non-create event when the record is missing", () => {
    useSubagents.getState().upsert("s1", { subagent_id: "ghost" }, false, "subagent.progress");
    expect(list("s1")).toHaveLength(0);
  });

  it("merges progress into an existing record and appends stream lines", () => {
    const u = useSubagents.getState().upsert;
    u("s1", { subagent_id: "a1", goal: "G", status: "running" }, true, "subagent.start");
    u("s1", { subagent_id: "a1", text: "step one", status: "running" }, false, "subagent.progress");
    const rec = list("s1")[0];
    expect(rec.stream.some((e) => e.kind === "progress" && e.text === "step one")).toBe(true);
  });

  it("ignores updates once the record reached a terminal status", () => {
    const u = useSubagents.getState().upsert;
    u("s1", { subagent_id: "a1", goal: "G", status: "running" }, true, "subagent.start");
    u("s1", { subagent_id: "a1", status: "completed", summary: "done" }, false, "subagent.complete");
    u("s1", { subagent_id: "a1", text: "late", status: "running" }, false, "subagent.progress");
    const rec = list("s1")[0];
    expect(rec.status).toBe("completed");
    expect(rec.stream.some((e) => e.text === "late")).toBe(false);
  });

  it("isolates sessions", () => {
    const u = useSubagents.getState().upsert;
    u("s1", { subagent_id: "a", goal: "A" }, true, "subagent.start");
    u("s2", { subagent_id: "b", goal: "B" }, true, "subagent.start");
    expect(list("s1")).toHaveLength(1);
    expect(list("s2")).toHaveLength(1);
  });
});

describe("clearSession", () => {
  it("drops only the targeted session", () => {
    const u = useSubagents.getState().upsert;
    u("s1", { subagent_id: "a", goal: "A" }, true, "subagent.start");
    u("s2", { subagent_id: "b", goal: "B" }, true, "subagent.start");
    useSubagents.getState().clearSession("s1");
    expect(list("s1")).toHaveLength(0);
    expect(list("s2")).toHaveLength(1);
  });
});

describe("buildSubagentTree", () => {
  const mk = (id: string, parentId: string | null, startedAt: number): SubagentProgress => ({
    id, parentId, goal: id, status: "running", taskCount: 1, taskIndex: 0,
    startedAt, updatedAt: startedAt, filesRead: [], filesWritten: [], stream: [],
  });

  it("nests children under parents and sorts roots by start time", () => {
    const tree = buildSubagentTree([
      mk("child", "root", 2),
      mk("root", null, 1),
      mk("root2", null, 3),
    ]);
    expect(tree.map((n) => n.id)).toEqual(["root", "root2"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["child"]);
  });

  it("treats an unknown parent as a root", () => {
    const tree = buildSubagentTree([mk("orphan", "missing", 1)]);
    expect(tree.map((n) => n.id)).toEqual(["orphan"]);
  });
});

describe("activeSubagentCount", () => {
  it("counts only running/queued records", () => {
    const base = { parentId: null, goal: "g", taskCount: 1, taskIndex: 0, startedAt: 0, updatedAt: 0, filesRead: [], filesWritten: [], stream: [] };
    const items: SubagentProgress[] = [
      { ...base, id: "1", status: "running" },
      { ...base, id: "2", status: "queued" },
      { ...base, id: "3", status: "completed" },
    ];
    expect(activeSubagentCount(items)).toBe(2);
  });
});
