import { defineConfig, devices } from "@playwright/test";

// E2E harness. These tests run the *built* SPA against a
// headless browser with the `/api/*` surface mocked via route interception —
// so they exercise real browser-only flows (boot gating, routing, login,
// capability degradation) without needing the Python backend or hermes-agent.
// That keeps them CI-runnable on a clean ubuntu container, same as Vitest.
//
// The dev/prod app talks to a real backend; here the contract under test is
// purely the front end's behaviour given known API responses. Backend behaviour
// is covered by pytest; the run/WS reconciliation logic by Vitest.

const PORT = 4173; // vite preview default

export default defineConfig({
  testDir: "./tests/e2e",
  // Vitest owns *.test.ts; Playwright owns *.spec.ts — no overlap, both can run.
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Build once, then serve dist/ with `vite preview`. Reused locally if already
  // up; always fresh in CI.
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
