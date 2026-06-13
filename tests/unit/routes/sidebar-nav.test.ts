// Flat sidebar nav: the pinned set (defaults or user-configured) renders as
// buttons; every other NAV_ROUTE collapses under the "More" disclosure.

import { describe, it, expect, beforeEach } from "vitest";
import { NAV_ROUTES, DEFAULT_PINNED, ROUTES } from "@/routes/registry";
import { useSidebarNav, effectivePinned } from "@/store/sidebar-nav";

beforeEach(() => {
  window.localStorage.clear();
  useSidebarNav.setState({ pinnedPaths: null });
});

describe("NAV_ROUTES", () => {
  it("lists exactly the visible routes in canonical order (work → ops)", () => {
    expect(NAV_ROUTES.map((r) => r.path)).toEqual([
      "/sessions", "/skills", "/artifacts", "/files", "/kanban",
      "/cron", "/analytics", "/logs",
    ]);
  });

  it("keeps chat/agents/settings-embedded routes routed but unlisted", () => {
    const listed = new Set(NAV_ROUTES.map((r) => r.path));
    // /agents is opened as a modal from the chat topbar, not a sidebar item.
    for (const path of ["/chat", "/agents", "/models", "/plugins", "/channels"]) {
      expect(listed.has(path)).toBe(false);
      expect(ROUTES.some((r) => r.path === path)).toBe(true);
    }
  });

  it("default-pins the core trio; the rest fall under More", () => {
    expect([...DEFAULT_PINNED]).toEqual(["/sessions", "/skills", "/artifacts"]);
    const more = NAV_ROUTES.filter((r) => !DEFAULT_PINNED.includes(r.path)).map((r) => r.path);
    expect(more).toEqual(["/files", "/kanban", "/cron", "/analytics", "/logs"]);
  });
});

describe("useSidebarNav", () => {
  it("effectivePinned falls back to the defaults until the user customizes", () => {
    expect(effectivePinned(null)).toEqual(DEFAULT_PINNED);
  });

  it("first toggle materializes the defaults, then applies the change", () => {
    useSidebarNav.getState().togglePinned("/kanban");
    expect(useSidebarNav.getState().pinnedPaths).toEqual([
      "/sessions", "/skills", "/artifacts", "/kanban",
    ]);
  });

  it("toggling a pinned route unpins it (it moves under More)", () => {
    useSidebarNav.getState().togglePinned("/skills");
    expect(useSidebarNav.getState().pinnedPaths).toEqual(["/sessions", "/artifacts"]);
  });

  it("reset returns to the default set", () => {
    useSidebarNav.getState().togglePinned("/logs");
    useSidebarNav.getState().reset();
    expect(useSidebarNav.getState().pinnedPaths).toBeNull();
  });
});
