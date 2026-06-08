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
    expect(moduleForPath("/skills")).toBe("agent"); // Tools
    expect(moduleForPath("/chat")).toBe("agent"); // hidden, still agent
    expect(moduleForPath("/files")).toBe("agent"); // hidden, the chat workspace's full page
    expect(moduleForPath("/cron")).toBe("activity");
    expect(moduleForPath("/logs")).toBe("activity");
    // Folded into the Settings modal — routed (hidden), grouped under agent.
    expect(moduleForPath("/models")).toBe("agent");
    expect(moduleForPath("/channels")).toBe("agent");
  });

  it("returns null for an unknown path", () => {
    expect(moduleForPath("/nope")).toBeNull();
  });
});

describe("firstRouteForModule", () => {
  it("is the lowest-order visible route", () => {
    expect(firstRouteForModule("agent")?.path).toBe("/sessions");
    expect(firstRouteForModule("activity")?.path).toBe("/cron");
  });

  it("never returns a hidden route", () => {
    expect(firstRouteForModule("agent")?.hidden).toBeFalsy();
  });
});

describe("moduleNavTarget", () => {
  it("navigates to the module's first route from a different module", () => {
    expect(moduleNavTarget("activity", "/sessions")).toBe("/cron");
    expect(moduleNavTarget("agent", "/cron")).toBe("/sessions");
  });

  it("stays put when already on a visible route of that module", () => {
    expect(moduleNavTarget("agent", "/sessions")).toBeNull();
    expect(moduleNavTarget("activity", "/cron")).toBeNull();
  });

  it("stays put when on a hidden in-module route (e.g. /chat, /files, /models)", () => {
    // The whole point: clicking "Agent" while on /chat must not yank to /sessions.
    expect(moduleNavTarget("agent", "/chat")).toBeNull();
    expect(moduleNavTarget("agent", "/files")).toBeNull();
    expect(moduleNavTarget("agent", "/models")).toBeNull();
  });
});
