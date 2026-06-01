# E2E Tests (Playwright)

Status: **active** (bootstrapped in the owner-review D13 pass, 2026-05-31).

Browser smoke tests for flows that pytest (backend) and Vitest (pure logic /
store) don't exercise end to end: boot gating, routing, login, capability
degradation.

## How they work

The tests run the **built** SPA (`vite preview` of `dist/`) against headless
Chromium, with the entire `/api/*` surface **mocked via Playwright route
interception** (see [`mocks.ts`](./mocks.ts)). So they need **no Python backend
and no hermes-agent** — they run on a clean CI container exactly like Vitest.

The contract under test here is purely the front end's behaviour given known
API responses. Real backend behaviour is covered by `pytest`; the run/WS
reconciliation logic by Vitest (`*.test.ts`).

- `playwright.config.ts` (repo root) — `webServer` builds + previews `dist/` on
  `:4173`; `testMatch` is `*.spec.ts` (Vitest owns `*.test.ts`, no overlap).
- Vitest is configured to **exclude** `tests/e2e/**`, so the two runners never
  fight over the spec files.

## Running

```bash
pnpm e2e                      # build + preview + run (config handles the server)
pnpm exec playwright test --ui   # interactive
pnpm exec playwright install chromium   # first-time browser install
```

CI runs this as the **`E2E (Playwright)`** job in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

## Current coverage ([`smoke.spec.ts`](./smoke.spec.ts))

- Loopback-trusted boot lands on the Sessions shell.
- Module-tab click navigates (D19, end-to-end).
- Degraded mode shows the SetupGuard warning gate.
- Password mode shows login, then reveals the shell after submit.

## Extending

Add `*.spec.ts` files here. For flows needing richer backend behaviour, extend
[`mocks.ts`](./mocks.ts) (remember: Playwright matches routes **last-registered-
first**, so register the catch-all before specific handlers). Real streaming
chat over WebSocket is the natural next layer — it needs either a mock WS server
or a live backend, so it's deferred until there's a reason to invest.
