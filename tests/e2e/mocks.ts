import type { Page, Route } from "@playwright/test";

// Minimal `/api/*` mocks so the built SPA boots without a backend. We stub only
// what SetupGuard + the shell need to reach the authenticated, "ready" state;
// every other /api/* call gets an empty-but-valid JSON response so panels
// render their empty states instead of erroring.

const READY_CAPS = {
  fsReadable: true,
  agentReady: true,
  dashboardReachable: true,
  gatewayReachable: true,
  mode: "ready",
  reasons: [],
  probedAt: 0,
  flags: {},
  limits: { max_concurrent_runs: 10, max_upload_bytes: 52428800, upload_retention_days: 30 },
};

// Playwright matches routes in REVERSE registration order (last wins), so the
// broad catch-all is registered FIRST and specific handlers AFTER it.

/** Empty-but-valid JSON for any /api/* we don't specifically stub. */
async function mockCatchAll(page: Page) {
  await page.route("**/api/**", (route: Route) =>
    route.fulfill({ json: route.request().method() === "GET" ? {} : { ok: true } }),
  );
}

/** Boot the SPA straight to the authenticated shell (loopback-trusted, no password). */
export async function mockReadyBackend(page: Page) {
  await mockCatchAll(page);
  await page.route("**/api/sessions**", (route: Route) =>
    route.fulfill({ json: { sessions: [] } }),
  );
  await page.route("**/api/capabilities", (route: Route) =>
    route.fulfill({ json: READY_CAPS }),
  );
  await page.route("**/api/auth-status", (route: Route) =>
    route.fulfill({ json: { requiresLogin: false, loggedIn: true, localhost: true } }),
  );
}

/** Password mode: backend requires login and isn't yet authenticated. */
export async function mockLoginRequired(page: Page) {
  let loggedIn = false;
  await mockCatchAll(page);
  await page.route("**/api/sessions**", (route: Route) =>
    route.fulfill({ json: { sessions: [] } }),
  );
  await page.route("**/api/capabilities", (route: Route) =>
    route.fulfill({ json: READY_CAPS }),
  );
  await page.route("**/api/login", (route: Route) => {
    loggedIn = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/auth-status", (route: Route) =>
    route.fulfill({ json: { requiresLogin: true, loggedIn, localhost: false } }),
  );
}

/** Degraded mode: agent import failed — SetupGuard shows the warning gate. */
export async function mockDegradedBackend(page: Page) {
  await mockCatchAll(page);
  await page.route("**/api/capabilities", (route: Route) =>
    route.fulfill({
      json: {
        ...READY_CAPS,
        agentReady: false,
        gatewayReachable: false,
        mode: "degraded",
        reasons: ["run_agent.AIAgent could not be imported"],
      },
    }),
  );
  await page.route("**/api/auth-status", (route: Route) =>
    route.fulfill({ json: { requiresLogin: false, loggedIn: true, localhost: true } }),
  );
}
