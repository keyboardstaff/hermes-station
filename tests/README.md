# Tests

This directory contains tests for Hermes Station.

## Structure

```text
tests/
├── __init__.py              # Python test package marker
├── conftest.py              # Shared pytest fixtures
├── setup.ts                 # Vitest global setup (mocks, polyfills)
├── unit/
│   ├── *.py                 # Backend unit tests (pytest)
│   ├── panels/
│   │   └── settings-panel.test.ts
│   ├── hooks/
│   │   └── breakpoint.test.tsx
│   ├── store/
│   │   ├── chat.test.ts
│   │   ├── chat-flow.test.ts
│   │   ├── chat-reconcile.test.ts
│   │   └── ws.test.ts
│   └── lib/
│       └── hermes-types.test.ts
├── integration/             # Reserved for future integration tests (currently no test files)
└── e2e/
│   └── README.md            # Tracked plan for Playwright E2E bootstrap
└── README.md                # This file
```

## Running Tests

```bash
# Frontend tests (Vitest)
pnpm vitest run

# Watch mode during development
pnpm vitest

# With coverage
pnpm vitest run --coverage

# Backend tests (pytest in hermes-agent venv)
bash scripts/test.sh
bash scripts/test.sh tests/unit/test_ws.py -q
```

## Coverage Goals

| Area | Target | Notes |
| ------ | ------ | ----- |
| `src/store/chat.ts` | 80% | Core state management |
| `src/lib/hermes-types.ts` | 60% | Type guards only |
| `src/hooks/useRunsStream.ts` | 50% | Requires mock fetch |

## Adding Tests

- **Frontend unit tests**: Place in `tests/unit/` mirroring the `src/` structure.
- **Backend unit tests**: Add `tests/unit/test_*.py` using shared fixtures from `tests/conftest.py`.
- **Integration tests**: Place in `tests/integration/`. These tests require the
  backend to be running (`pnpm dev` by default, or a TCP backend via `hms dev --port <N>`).
- **E2E tests**: Use Playwright (not yet configured). Place in `tests/e2e/`.

## Dependencies

```bash
pnpm add -D vitest @vitest/coverage-v8 jsdom @testing-library/react
```
