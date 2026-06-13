import { test, expect } from "@playwright/test";
import { mockReadyBackend, mockLoginRequired, mockDegradedBackend } from "./mocks";

// the first executable browser smoke tests. They drive the built SPA
// through its boot gating (SetupGuard) and the main authenticated path with the
// backend mocked, so they run in CI with no Python / hermes-agent. This is the
// harness foundation; richer flows (real chat streaming over WS, etc.) layer on
// later against a live or richer-mocked backend.

test.describe("boot & shell", () => {
  test("loopback-trusted boot lands on the chat shell", async ({ page }) => {
    await mockReadyBackend(page);
    await page.goto("/");

    // The shell rendered (not the "Initializing…" / error gate).
    await expect(page.locator('aside[aria-label="Sidebar"]')).toBeVisible();
    // Default destination → /chat (most recent conversation, or the intro).
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("sidebar nav reaches the Sessions page", async ({ page }) => {
    await mockReadyBackend(page);
    await page.goto("/sessions");
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();
    await expect(page).toHaveURL(/\/sessions$/);
  });

  test("More flyout reveals secondary nav (hover + click navigates)", async ({ page }) => {
    await mockReadyBackend(page);
    await page.goto("/sessions");
    await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

    // Kanban is not pinned by default — it lives under the "More" hover flyout.
    await page.getByRole("button", { name: "More" }).first().hover();
    await page.getByRole("link", { name: "Kanban" }).click();
    await expect(page).toHaveURL(/\/kanban$/);
  });
});

test.describe("degraded mode", () => {
  test("shows the degraded gate when the agent isn't importable", async ({ page }) => {
    await mockDegradedBackend(page);
    await page.goto("/");

    // SetupGuard's degraded warning — not the full shell.
    await expect(page.getByText(/could not be imported/i)).toBeVisible();
    await expect(page.locator('aside[aria-label="Sidebar"]')).toHaveCount(0);
  });
});

test.describe("login flow", () => {
  test("password mode shows login, then reveals the shell after submit", async ({ page }) => {
    await mockLoginRequired(page);
    await page.goto("/");

    const pw = page.locator('input[type="password"]');
    await expect(pw).toBeVisible();
    await pw.fill("hunter2");
    await page.getByRole("button", { name: /log ?in|sign ?in|enter|submit/i }).first().click();

    // After login the auth-status mock flips loggedIn=true → shell appears.
    await expect(page.locator('aside[aria-label="Sidebar"]')).toBeVisible();
  });
});
