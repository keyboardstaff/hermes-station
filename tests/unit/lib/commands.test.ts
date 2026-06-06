import { describe, it, expect, vi } from "vitest";
import { navCommands, filterCommands, type Command } from "@/lib/commands";
import { ROUTES } from "@/routes/registry";
import { en } from "@/i18n/en";

// The ⌘K palette's nav commands must stay in lockstep with the single ROUTES
// table (the old GlobalSearch kept a parallel hand-maintained list that drifted).

describe("navCommands", () => {
  it("derives exactly one command per route, labelled from i18n nav.*", () => {
    const navigate = vi.fn();
    const cmds = navCommands(en, navigate);
    expect(cmds).toHaveLength(ROUTES.length);
    // Every route is represented, with its i18n label and a page group.
    for (const r of ROUTES) {
      const cmd = cmds.find((c) => c.id === `nav:${r.path}`);
      expect(cmd).toBeDefined();
      expect(cmd!.group).toBe("page");
      expect(cmd!.label).toBe(en.nav[r.labelKey]);
    }
  });

  it("run() navigates to the route's path", () => {
    const navigate = vi.fn();
    const cmds = navCommands(en, navigate);
    cmds.find((c) => c.id === "nav:/logs")!.run();
    expect(navigate).toHaveBeenCalledWith("/logs");
  });
});

describe("filterCommands", () => {
  const cmds: Command[] = [
    { id: "a", label: "New chat", group: "action", keywords: "session conversation", run: () => {} },
    { id: "b", label: "Toggle theme", group: "action", keywords: "dark light", run: () => {} },
    { id: "p", label: "Settings", group: "page", keywords: "/settings", run: () => {} },
  ];

  it("empty query returns everything", () => {
    expect(filterCommands(cmds, "")).toHaveLength(3);
    expect(filterCommands(cmds, "   ")).toHaveLength(3);
  });

  it("matches the label case-insensitively", () => {
    expect(filterCommands(cmds, "THEME").map((c) => c.id)).toEqual(["b"]);
  });

  it("matches on keywords too (e.g. the route path or synonyms)", () => {
    expect(filterCommands(cmds, "/settings").map((c) => c.id)).toEqual(["p"]);
    expect(filterCommands(cmds, "conversation").map((c) => c.id)).toEqual(["a"]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterCommands(cmds, "zzzz")).toEqual([]);
  });
});
