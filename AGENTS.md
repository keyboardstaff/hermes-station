# AGENTS.md — Working on Hermes Station

> This file governs how any agent or developer changes this repository.
> It is **not** a generic style guide; every rule below traces to a real
> property of this codebase. Read it before touching code.
>
> Companion documents: [`ARCHITECTURE.md`](./ARCHITECTURE.md) (system model
> & boundaries), [`PROJECT_CONSTITUTION.md`](./PROJECT_CONSTITUTION.md)
> (inviolable rules), [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
> (runtime mechanics), [`docs/WS_PROTOCOL.md`](./docs/WS_PROTOCOL.md)
> (the closed WS contract), [`docs/REST_API.md`](./docs/REST_API.md) (the REST
> surface + auth/CSRF/rate-limit), [`docs/UI_CONVENTIONS.md`](./docs/UI_CONVENTIONS.md)
> (UI primitives, tokens, hover/button/input rules).

---

## 0. The one thing to internalize first

**Hermes Station is a _client_, not an agent.** It is an in-process
gateway *platform plugin* for `hermes-agent`. The agent runtime, the
tool dispatch, the dangerous-command policy, the session store
(`state.db`), the model resolution, the slash-command registry — **all of
that is owned by hermes-agent.** Station surfaces those capabilities over
REST + WebSocket and renders a UI on top.

If you find yourself about to *reimplement* something the agent already
does (a tool, a model router, an allowlist, a session schema), stop. The
correct move is almost always to call upstream through the shim, or to
ask whether the capability belongs upstream.

---

## 1. The three layers — know which one you're in

| Layer | Owns | Lives in | You may… |
|---|---|---|---|
| **Agent** | runtime, tools, `state.db`, model resolution, approval policy | `hermes-agent` venv | **only call** via the shim |
| **Gateway** | platform multiplexing, lifecycle (launchd/systemd), session vars | `hermes-agent` venv | **only call** via the shim |
| **Client (Station)** | REST + WS surface, the SPA, run orchestration glue, the Dashboard sidecar supervisor | this repo | freely change |

Every change should be classifiable into exactly one layer. A change that
"reaches across" a boundary (e.g. a route that imports `run_agent`
directly, or a SPA store that owns transcript truth) is a defect even if
it works.

---

## 2. The upstream boundary is the most important rule in this repo

All contact with hermes-agent internals funnels through **three modules**:

- [`server/lib/upstream_shim.py`](./server/lib/upstream_shim.py) — the
  **only** file allowed to `import hermes_cli / gateway / tools /
  run_agent / hermes_constants / hermes_state`. Everything else goes
  through `from server.lib.upstream_shim import shim` →
  `shim.<group>.<symbol>`.
- [`server/lib/upstream_paths.py`](./server/lib/upstream_paths.py) —
  paths, labels, service names (`hermes_home()`, `state_db_path()`,
  `launchd_label()`, …).
- [`server/lib/config_reader.py`](./server/lib/config_reader.py) —
  config.yaml-derived values (`hms_port()`, `dashboard_url()`,
  `max_concurrent_runs()`, …).

**Rules:**

1. Never inline an upstream literal (`1313`, `9119`, `ai.hermes.gateway`,
   `~/.hermes`, `state.db`). Use the wrapper. CI enforces this via
   [`scripts/lint_no_hardcoding.sh`](./scripts/lint_no_hardcoding.sh).
2. Never `import` an upstream module outside the shim. Same lint.
3. Every upstream symbol you add to the shim must be **fetched
   best-effort** (`_try_import`, returns `None` on absence) and consumers
   must **gate on `None`** or on a `CapabilityFlags` entry. The agent host
   evolves independently of us; assume any symbol can vanish or be
   renamed between releases.
4. If a feature depends on a *private* upstream symbol (underscore-
   prefixed — we already lean on ~12 of them, e.g.
   `_load_gateway_config`, `_get_platform_tools`,
   `_BUILTIN_DASHBOARD_THEMES`), add a `CapabilityFlags` field and a
   graceful-degradation path. Private symbols are the highest-churn
   coupling we have; treat each as a liability you must be able to lose.

The `# hms-allow-hardcoding` escape hatch exists but is for genuinely
unavoidable cases (it's used ~6 times today). Adding one is a review
flag, not a convenience.

---

## 3. Before you change anything — the pre-flight

```bash
# 1. Backend tests run under the hermes-agent venv, NOT the local venv/.
bash scripts/test.sh                 # full suite
bash scripts/test.sh tests/unit/test_ws.py -q

# 2. Frontend types (there is NO eslint gate — typecheck is your net).
pnpm typecheck

# 3. The boundary lint that CI runs.
bash scripts/lint_no_hardcoding.sh

# 4. Style/token lint (no inline styles — design tokens only).
pnpm lint:styles
```

If your change touches **security or approvals**, you must additionally
run the tests CI *deselects* (they need the agent venv and are skipped in
the clean CI container — see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)):

```bash
bash scripts/test.sh tests/unit/test_security.py \
  tests/unit/test_approvals.py \
  tests/unit/test_approval_4_choices.py \
  tests/unit/test_approvals_integration.py \
  tests/unit/test_uninstall_rollback.py
```

CI green is **not** sufficient for these areas — the gate has holes there
by construction (documented in the CI header).

---

## 4. Development & debugging flows

- **Dev loop:** `pnpm dev` (= `hms dev`). Vite on **:3131** is the only
  open port; the Python backend binds a Unix socket
  (`~/.hermes/run/station-dev.sock`) so it never collides with the
  production gateway on **:1313**. Override with `HMS_DEV_SOCK=` or run a
  TCP backend with `hms dev --port N`.
- **Wrong interpreter** is the #1 dev failure (`ModuleNotFoundError:
  hermes_constants`). Fix: `HMS_PYTHON=$HOME/.hermes/hermes-agent/venv/bin/python pnpm dev`.
- **Live smokes** (need a running backend): `scripts/smoke_api_routes.py`,
  `scripts/smoke_run_ws.py`, `scripts/smoke_approval_bridge.py`.
- **Is upstream reachable?** `GET /api/capabilities` (returns
  `flags` + `limits` + `mode: ready|degraded`) and `hms status`. After
  changing the shim, `POST /api/reprobe` re-runs the probe without a
  restart.
- **Production** is `hms install` → `hermes gateway restart`; the adapter
  loads in-process and the SPA is served from `dist/`.

---

## 5. Code-review checklist (the project-specific traps)

When reviewing (or self-reviewing) a diff, check each of these — they are
the recurring failure modes of *this* codebase, not generic nits:

- [ ] **Boundary:** no new `hermes_*` import outside the shim; no new
      hardcoded upstream literal; new private-symbol use has a capability
      flag + degradation path.
- [ ] **State ownership:** the change writes only to a store it *owns*
      (see the ownership table in `ARCHITECTURE.md`). It does not make the
      SPA a second source of truth for transcript data — `state.db` is
      truth, `useChatStore` is a projection.
- [ ] **Run status vocabulary:** any new status string is one of the
      canonical set. Do **not** add a new spelling. (We currently have a
      real split — `start_slash_run` emits `"error"` while
      `_run_to_completion` emits `"failed"`, and `hermes-types.ts` still
      declares `"pending"/"stopped"` that never occur. Don't widen it
      further; prefer narrowing it.)
- [ ] **Chat-runtime invariants:** streaming events target a single
      `turn-<runId>-assistant` bubble; reconnect dedups on `seq`; terminal
      frames carry `session_id`. If you add a place that "clears the
      trailing streaming bubble," you are duplicating logic that already
      exists in ≥4 spots in [`useRunsStream.ts`](./src/hooks/useRunsStream.ts)
      — extract, don't copy.
- [ ] **WS protocol:** new frame types follow the 5-step procedure in
      `docs/WS_PROTOCOL.md`, are added to `src/lib/ws-types.ts`, and are
      `<domain>.<verb>` named. The vocabulary is closed.
- [ ] **Degraded mode:** the feature behaves sanely when
      `capabilities.mode === "degraded"` (agent not importable). Gate UI
      with `<CapabilityGate>` rather than assuming readiness.
- [ ] **Off-loop I/O:** any blocking SessionDB / filesystem call inside an
      async handler is marshalled via `run_db()` / `run_in_executor`.
- [ ] **Tests:** backend logic has a `tests/unit/test_*.py`; **frontend
      behavioral logic** (stores, hooks, reconciliation) has a vitest —
      this is the thinnest part of our coverage, so new logic here needs
      tests more than anywhere else.

---

## 6. Risk assessment before merge

Rate the change against these axes; anything "high" needs explicit
sign-off in the PR description:

1. **Upstream coupling delta** — does it add/deepen dependence on private
   upstream symbols? Which `CapabilityFlags` covers it?
2. **State-boundary delta** — does it introduce a new writer to an
   existing store, or a new source of truth?
3. **Security-surface delta** — does it touch `auth.py`, `csrf.py`,
   `host_guard`, the cookie, or the localhost-trust assumption? If yes,
   the threat model in `PROJECT_CONSTITUTION.md` §7 must still hold and
   the deselected security tests must pass locally.
4. **Contract delta** — does it change a REST shape or a WS frame? REST
   has no contract doc yet (a known gap); WS changes must update
   `WS_PROTOCOL.md` + `ws-types.ts` in the same commit.
5. **Complexity delta** — does it push a file further past budget? The
   over-budget files today are `Composer.tsx` (1,387 LOC),
   `SettingsPanel.tsx` (1,226), `FilesSideTree.tsx` (904). Don't grow
   them; split.

---

## 7. Definition of done

A change is done when:

- `bash scripts/test.sh`, `pnpm typecheck`, `bash scripts/lint_no_hardcoding.sh`,
  `pnpm lint:styles` all pass.
- Security/approval changes also pass the CI-deselected tests locally.
- New upstream contact is shimmed + capability-gated + degrades.
- New WS frames are documented + typed.
- State writes respect ownership; no new source-of-truth.
- The diff did not grow an already-over-budget file; if it must, it
  carries a note in the PR explaining why a split wasn't feasible.
- Debt you knowingly leave is recorded in the debt register (see
  `PROJECT_CONSTITUTION.md` §10) — **not** as a prose comment that no one
  can grep (we currently have **0** `TODO/FIXME` markers but real,
  untracked debt living in narrative comments; do not perpetuate that).
