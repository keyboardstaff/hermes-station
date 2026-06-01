# PROJECT_CONSTITUTION.md — Hermes Station

> The constitution is the slowest-changing document in the repo. Code,
> features, and even the architecture docs serve it. Amending it is a
> deliberate act, recorded in git with rationale. Everything here is
> derived from how Hermes Station is *actually* built — not a template.

---

## 1. Mission

**Hermes Station is the _complete_ web client for `hermes-agent`'s
gateway** — its north star is that every capability reachable from the
CLI or any messaging platform is also reachable here. Its job is to
surface the agent's capabilities — chat, runs, approvals, sessions,
skills, models, files, lifecycle — over a clean REST + WebSocket surface
and a multi-panel UI, **faithfully and without owning the agent's domain
logic.**

Station succeeds when a capability that exists upstream is reachable in
the UI with minimal, honest glue; it fails when it grows a parallel
implementation of something the agent already owns.

The one deliberate exception to "pure client" is **convenience process
supervision** — Station lifecycles the Dashboard sidecar and auto-starts
an idle gateway. This is a sanctioned, distinguishing feature, not scope
creep; treat it as in-charter.

---

## 2. Core principles

1. **Thin client over a thick agent.** Prefer calling upstream to
   reimplementing it. Glue is allowed; forks are not.
2. **One door to upstream.** All agent contact passes through the shim
   layer. The agent host evolves on its own schedule; our blast radius
   when it does must be one file, not fifty.
3. **One owner per piece of state.** Reads are free; writes belong to the
   owner. (See `ARCHITECTURE.md` §3.)
4. **Truth lives in `state.db`; the UI renders a projection.** The live
   transcript is reconstructed and reconciled, never authoritative.
5. **Degrade, don't assume.** Missing upstream symbols flip a capability
   flag and gate UI; they never crash a request.
6. **Recoverable and resumable by design.** Runs survive reconnects
   (seq + replay ring) and refreshes (persisted resume keys). Any new
   long-lived operation inherits this expectation.
7. **The security model is explicit and conservative.** Single trusted
   user on a trusted host; loopback is full trust; password gates only
   non-loopback. (See §7.)

---

## 3. Inviolable rules

Numbered for citation in reviews. Each is enforced or enforceable.

1. **The upstream boundary is sacred.** No `hermes_cli / gateway / tools /
   run_agent / hermes_constants / hermes_state` import outside
   `server/lib/upstream_shim.py`. No upstream literal outside
   `upstream_paths.py` / `config_reader.py`. Enforced by
   `scripts/lint_no_hardcoding.sh` in CI.
2. **`state.db` is read-through.** Mutate only via upstream-public APIs
   (`set_session_title`, `delete_session`). Never raw SQL, never a schema
   assumption, never a post-hoc `source` flip.
3. **One run-status vocabulary.** The canonical set is
   `queued → running → {completed | failed | cancelled}`, shared across the
  server, the WS frames, and the TS types. (Repaired in the 2026-05-30
  run-model pass: the
   `start_slash_run` `"error"` outlier and the dead `RunCreated`
   `"pending"/"stopped"` union were removed; a regression test pins it.)
   No new spellings; new terminal frames go through `_terminal_frame()`.
4. **The WebSocket protocol is a closed, versioned contract.** Frames are
   `<domain>.<verb>`. Adding one follows the 5-step procedure in
   `docs/WS_PROTOCOL.md` and updates `src/lib/ws-types.ts` in the same
   commit. Unknown inbound types are dropped, not errored.
5. **No hardcoding of upstream-owned values.** If hermes-agent decides it,
   read it at runtime through the wrapper.
6. **Capability-gated features.** Every upstream dependency has a
   `CapabilityFlags` entry and a defined behavior when absent. Private
   upstream symbols (underscore-prefixed) are liabilities; each must be
   survivable.
7. **The threat model is not weakened silently.** Any change to
   `auth.py` / `csrf.py` / `host_guard` / the session cookie / the
   localhost-trust rule requires re-validating §7 and running the
   CI-deselected security tests locally.

---

## 4. Complexity-control principles

The project is ~50k LOC (17k Python, 27k TS). It stays maintainable only
under active complexity pressure.

- **File-size budget: ~500 LOC for a component/module.** Files over budget
  today are debt to be split, not a precedent to follow: `Composer.tsx`
  (1,387), `SettingsPanel.tsx` (1,226), `FilesSideTree.tsx` (904),
  `SessionList.tsx` (697), `files.py` (704). Do not grow them.
- **No duplicated lifecycle logic.** If an operation appears in ≥3 control
  paths (e.g. "clear the trailing streaming bubble" lives in ≥4 places in
  `useRunsStream.ts`), extract it. Duplication of state transitions is how
  the projection drifts from truth.
- **One abstraction per concept.** Two run paths, two event-type
  hierarchies (`ws-types.ts` *and* the stale SSE-flavored types in
  `hermes-types.ts`), and three status vocabularies are each a "pick one"
  debt. Converge; don't add a fourth.
- **Prefer deletion.** The cheapest maintainable code is the code that
  isn't there. Stale aspirational types (e.g. the `GET /v1/runs/.../events`
  SSE types that describe an endpoint we don't have) should be removed,
  not preserved "just in case."

---

## 5. Naming principles

- **WS frames:** `<domain>.<verb>`; client→server present tense
  (`run.stop`, `approval.resolve`), server→client past/result tense
  (`run.event`, `discovery.changed`, `run.stop.ack`).
- **Run sub-events:** `<noun>.<state>` (`message.delta`, `tool.started`,
  `run.completed`).
- **Routes:** `/api/<domain>[/<id>][/<sub>]`; one domain per route module.
- **Shim groups:** mirror the upstream module they wrap
  (`shim.gateway`, `shim.approval`, `shim.skills`).
- **Status strings, channels, and capability flags are closed
  vocabularies** — adding a member is a deliberate, reviewed act, not an
  inline string literal.

---

## 6. State-management principles

- Identify the **owner** before writing (`ARCHITECTURE.md` §3). If your
  change needs to write state someone else owns, you have the wrong
  design.
- **Projection vs. truth:** UI stores reconcile *toward* `state.db`. Only
  resume *keys* (`activeRunId`, `runningBySession`) and *preferences* are
  persisted (`partialize`) — never transcript bodies as truth.
- **Single-flight per run:** the server enforces `max_concurrent_runs` via
  a TOCTOU-safe `reserve`; the client tracks `runningBySession` so a
  session has at most one in-flight run it can re-attach to.
- **Invalidate, don't mutate, derived caches:** server-derived read models
  (sessions, analytics, discovery) are refreshed by query invalidation,
  driven where possible by `discovery.changed`, not by hand-patching cache
  entries (the optimistic sidebar prepend is the rare, deliberate
  exception).

---

## 7. Security principles (the threat model)

- **Audience:** a single trusted user on a trusted host. This is **not**
  multi-tenant isolation, and must never be presented as such.
- **Loopback is full trust.** Any `127.0.0.0/8` / `::1` / AF_UNIX
  connection skips auth entirely — every local process can drive the
  agent, which runs arbitrary shell commands. The dangerous-command
  approval flow is a **UX guardrail, not a sandbox.**
- **Password gates only non-loopback**, and is *required* before binding
  `0.0.0.0` (enforced at config-validate time and in the settings route).
  CSRF is enforced by the `X-HMS-CSRF` header on mutating verbs.
- **Reverse-proxy caveat:** `X-Forwarded-For` is honored only from a
  loopback base. A proxy that forwards LAN traffic over loopback without a
  correct XFF would misclassify it as trusted. Document this anywhere
  deployment is described.
- These properties are load-bearing and **partially untested in CI** (the
  security tests need the agent venv and are deselected). Treat the
  security tests as a manual gate for any change in this area.

---

## 8. Chat Runtime principles

The chat runtime is the project's hardest subsystem; it gets its own
article.

1. **`state.db` is truth; the transcript is a projection.** The agent
   writes the authoritative transcript at the *end* of a turn; the live
   bubbles are a best-effort reconstruction until then.
2. **One bubble per turn.** All streaming events (delta / reasoning /
   tool) target `turn-<runId>-assistant`. A turn never splits into
   duplicate bubbles.
3. **Reconciliation is centralized and idempotent.** Rebuild from the DB
   on session entry (`reconcileSession`), preserving only the in-flight
   turn's live segments. Do not scatter ad-hoc transcript surgery.
4. **Resumability is mandatory.** Seq-dedup on the client, replay ring on
   the server, persisted resume keys, status re-verification after any
   outage. New run-producing features inherit all four.
5. **One run *contract*.** Agent runs and slash runs share one status
   vocabulary and one terminal-frame contract (`_terminal_frame()`), even
   though their executions differ (streaming agent vs one-shot gateway
  handler) — that execution difference is inherent, not debt (unified in
  the 2026-05-30 run-model pass). Any new run-producing path emits terminals via
   `_terminal_frame()`.
6. **No preemptive content deletion.** `stream.reset` does not delete
   pre-tool text; the final response arrives via `run.completed.output`.
   The history of this file is a history of deleting content too eagerly —
   respect the hard-won ordering.

---

## 9. Long-term maintenance principles

- **CI gates must trend toward hard, never soft.** Progress (owner review):
  pyright is a **hard gate** at 0 errors (D4); security/approval tests run in
  CI or self-skip via `pytest.importorskip` (D5); ESLint is a **strict gate**
  at `--max-warnings 0` — 0 errors, 0 warnings (D6). All CI hardening gates
  are now hard. Keep them at zero (fix, narrow, or justify with an inline
  `eslint-disable` + reason); never reintroduce `continue-on-error`.
- **Contracts get documents.** The WS surface has `WS_PROTOCOL.md` +
  `ws-types.ts`. The REST surface (21 route modules) has **no** contract
  doc — that gap should close as the surface stabilizes.
- **The shim is reviewed every time upstream is upgraded.** A hermes-agent
  version bump is a planned event: re-run `POST /api/reprobe`, check
  `CapabilityFlags`, and confirm no private symbol silently vanished.
- **i18n stays in parity.** `en.ts` and `zh.ts` are both first-class
  (currently 32/32 top-level keys, in sync). A new string lands in both,
  typed against `i18n/types.ts`.

---

## 10. Debt discipline (anti-drift)

The repo has **0** `TODO/FIXME` markers — not because there is no debt,
but because debt is recorded in narrative comments that cannot be tracked
("advisory for now," "audit note," "Long-term fix:"). That is itself a
drift risk: untracked debt is unmanaged debt.

**Rule:** known debt lives in a single, greppable **debt register** (a
`DEBT.md` or an issue label), each item naming the file, the reason, and
the exit condition. The current standing items, to seed it:

| # | Debt | Exit condition |
|---|---|---|
| D1 | Two run paths (`start_run` vs `start_slash_run`) diverge in status, events, usage | one run abstraction |
| D2 | Run-status vocabulary drift (`error`/`failed`/`pending`/`stopped`) | one closed vocabulary across server + WS + TS |
| D3 | Stale SSE-flavored types in `hermes-types.ts` for a non-existent `/v1/runs/.../events` | delete or reconcile |
| D4 | Pyright advisory (28 errors) | flip `continue-on-error: false` |
| D5 | Security/approval/uninstall tests deselected in CI | mock upstream → run in CI |
| D6 | No ESLint for the SPA | add a CI lint gate |
| D7 | God-components over budget (`Composer`, `SettingsPanel`, `FilesSideTree`) | split below budget |
| D8 | No REST contract doc | author one as the surface stabilizes |
| D9 | ~12 private upstream symbols in the shim | track per release; lobby upstream for public APIs |
| D10 | Frontend test coverage ~4.5% of LOC vs backend ~41% | cover stores/hooks/reconciliation |

Anti-drift summary — every rule here exists to prevent one of:
**architecture drift** (§3.1, §3.6), **naming drift** (§5), **hardcoding**
(§3.5), **temporary patching** (§9, §10), **state confusion** (§3.2,
§3.3, §6, §8), **duplicated logic** (§4), and **debt going untracked**
(§10).
