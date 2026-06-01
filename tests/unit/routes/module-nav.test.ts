import { describe, it, expect } from "vitest";
import {
  moduleForPath,
  firstRouteForModule,
  moduleNavTarget,
} from "@/routes/registry";

// clicking a sidebar module tab navigates to that module's landing page,
// unless the current route already belongs to the module.

describe("moduleForPath", () => {
  it("maps visible + hidden routes to their module", () => {
    expect(moduleForPath("/sessions")).toBe("agent");
    expect(moduleForPath("/chat")).toBe("agent"); // hidden, still agent
    expect(moduleForPath("/cron")).toBe("tasks");
    expect(moduleForPath("/files")).toBe("tasks"); // hidden, still tasks
    expect(moduleForPath("/models")).toBe("manage");
    expect(moduleForPath("/settings")).toBe("manage"); // hidden
  });

  it("returns null for an unknown path", () => {
    expect(moduleForPath("/nope")).toBeNull();
  });
});

describe("firstRouteForModule", () => {
  it("is the lowest-order visible route", () => {
    expect(firstRouteForModule("agent")?.path).toBe("/sessions");
    expect(firstRouteForModule("tasks")?.path).toBe("/cron");
    expect(firstRouteForModule("manage")?.path).toBe("/skills");
  });

  it("never returns a hidden route", () => {
    expect(firstRouteForModule("agent")?.hidden).toBeFalsy();
  });
});

describe("moduleNavTarget", () => {
  it("navigates to the module's first route from a different module", () => {
    expect(moduleNavTarget("tasks", "/sessions")).toBe("/cron");
    expect(moduleNavTarget("manage", "/cron")).toBe("/skills");
    expect(moduleNavTarget("agent", "/models")).toBe("/sessions");
  });

  it("stays put when already on a visible route of that module", () => {
    expect(moduleNavTarget("agent", "/sessions")).toBeNull();
    expect(moduleNavTarget("manage", "/models")).toBeNull();
  });

  it("stays put when on a hidden in-module route (e.g. /chat, /files)", () => {
    // The whole point: clicking "Agent" while on /chat must not yank to /sessions.
    expect(moduleNavTarget("agent", "/chat")).toBeNull();
    expect(moduleNavTarget("tasks", "/files")).toBeNull();
    expect(moduleNavTarget("manage", "/settings")).toBeNull();
  });
});
