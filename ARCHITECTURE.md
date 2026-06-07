# ARCHITECTURE.md — System Model & Boundaries

> This document defines the **system model, domain division, state
> ownership, and the architectural boundaries that must not be crossed.**
> It is the shared mental model for all future work.
>
> For runtime *mechanics* — the exact frame sequence of a run, the
> approval handshake, the middleware chain — see
> [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and
> [`docs/WS_PROTOCOL.md`](./docs/WS_PROTOCOL.md). This file is the
> *conceptual* layer above those; where they describe "how," this
> describes "who owns what, and what you may not do."

---

## 1. System model

Hermes Station is the **complete web client** for `hermes-agent`'s
gateway — its north star is that every capability reachable from the CLI
or any messaging platform is also reachable here. It ships as an
**in-process platform plugin**: when the gateway
boots, it discovers Station, instantiates
[`StationAdapter`](./server/adapter.py), and the adapter starts an
aiohttp server **inside the same Python process** as the agent runtime.

```
Browser ── REST /api/*  +  WebSocket /ws ──▶  Station backend (aiohttp)
                                                    │  in-process Python calls
                                                    ▼
                                          hermes-agent (AIAgent, GatewayRunner,
                                          tools.approval, hermes_state.SessionDB)
                                                    │  proxies /api/dashboard/*
                                                    ▼
                                          Dashboard (separate FastAPI sidecar,
                                          supervised by Station)
```

Three consequences flow from "in-process plugin," and they shape
everything:

1. **No IPC to the agent.** Station calls `AIAgent.run_conversation()` as
   a function on a worker thread. There is no protocol between Station and
   the agent; there is a Python import boundary — which is exactly why the
   shim ([`upstream_shim.py`](./server/lib/upstream_shim.py)) exists and
   matters so much.
2. **`agent_importable` *is* the liveness signal.** The same interpreter
   that binds `:1313` is the one that imports `AIAgent`; if the import
   fails, Station runs in **degraded mode** and the UI gates features.
   See [`capabilities.py`](./server/capabilities.py).
3. **The Dashboard is _not_ us — but Station owns its lifecycle.** The
   Dashboard is a separate FastAPI process. Station *supervises it*
   (`DashboardSupervisor`: spawn, health-probe, crash-loop backoff,
   foreign-pid safety), *auto-starts the gateway when it is installed but
   idle* (`_start_gateway_if_idle`), and *transparently proxies*
   `/api/dashboard/*`. This convenience-oriented process supervision is a
   **deliberate, sanctioned distinguishing feature** of Station — the one
   place it intentionally acts as more than a pure client. It is
   in-charter, not a boundary violation. We never speak the Dashboard's
   protocol.

---

## 2. Domain division

The backend is organized by **domain routes** under
[`server/routes/`](./server/routes/), each `attach(app)`-ed in
[`app.py`](./server/app.py). Domains:

- **Chat & runs** — `runs`, `chat` (sessions+messages+search merged), `ws`,
  `approvals`, `allowlist`. The live core.
- **Capability surfaces** — `models`, `skills_content`, `plugins`,
  `profiles`, `config`, `settings`, `password`.
- **Workspace** — `files`, `upload`, `projects`, `kanban`.
- **Observability** — `analytics`, `logs`, `lifecycle`, `dashboard_proxy`.

The frontend mirrors this as **panels** ([`src/panels/`](./src/panels/)),
one per navigable route, declared once in
[`src/routes/registry.tsx`](./src/routes/registry.tsx). Panels compose
**hooks** (`src/hooks/`) that wrap React Query over the REST surface, plus
**stores** (`src/store/`) for client-owned state.

**Naming convention — `session` vs `chat`.** A **session** is the
*persisted* unit — it is upstream's term (`state.db` rows, `SESSION_ID`,
`SessionDB`). A **chat** is the *live view* of one session: the streaming
`/chat` panel plus its [`useChatStore`](./src/store/chat.ts) projection.
"Chat" is never a persisted noun — on disk and upstream it is always a
session. So: `SessionRecents` lists persisted sessions (it powers the Sidebar
**Recents** rail — *not* the `/sessions` table); `SessionsPanel` is the
`/sessions` browser; and `ChatStream` / `ChatThread` render a chat
transcript. When in doubt, the thing you store is a session and the thing
you watch stream is a chat.

**Concept — file-tree `root` vs agent `cwd`.** The agent's **cwd** is the
*execution* directory: the **active workspace** (`active_workspace()` in
[`files.py`](./server/routes/files.py)), resolved by
[`workspace_cwd.resolve_active_cwd`](./server/lib/workspace_cwd.py) to a
chosen workspace, the `"hermes"` sentinel (`$HERMES_HOME`), else `~/workspace`.
Picking any entry in the [`FilesSideTree`](./src/components/files/FilesSideTree.tsx)
workspace switcher — including **~/.hermes** — sets the active workspace, which
sets `TERMINAL_CWD` (live, no restart) **and** seeds a per-run system preface so
the model knows its absolute working dir (`runs._workspace_context_history`).
The file-tree **browse root** follows the same selection, so the two normally
agree; they only diverge transiently (e.g. mid-mutation) and the agent always
keys off the active workspace, never the browse root. *Slash commands*
(`/new`, `/compress`, …) route through upstream's deterministic command
handlers, not an agent turn, so they neither need nor receive the preface.

---

## 3. State ownership (the single most important table in this repo)

Every piece of state has **exactly one owner / writer.** Reading is free;
writing is the owner's privilege. Violating this is the root cause of the
"content disappears" / "duplicate bubble" class of bugs already scarred
into the chat store.

| State | Owner / sole writer | Everyone else | Persistence |
|---|---|---|---|
| **`state.db`** (sessions, messages, FTS) | **hermes-agent** | Station reads via `db().list_sessions_rich/get_messages/search_messages`; mutates **only** via upstream-public `set_session_title` / `delete_session` | sqlite at `$HERMES_HOME/state.db` |
| **In-flight run state + replay ring** | [`server/runs.py`](./server/runs.py) `RunRegistry` / `RunHandle` | read via `GET /api/runs/{id}` | in-memory only |
| **`config.yaml`** | operator; Station writes via `settings`/`password` routes using `yaml_edit` (comment-preserving) | `config_reader` reads | `$HERMES_HOME/config.yaml` |
| **Auth sessions** | [`session_store.py`](./server/lib/session_store.py) | `auth_middleware` reads | `station/sessions.json` (0600) |
| **Approval pending mirror** | [`approvals.py`](./server/approvals.py) `ApprovalBridge._pending` | WS replay reads | in-memory |
| **Server-derived read models** (sessions list, analytics, discovery) | React Query cache | components read | memory, invalidated by `discovery.changed` |
| **Live transcript** | [`src/store/chat.ts`](./src/store/chat.ts) `useChatStore` | a **projection** of `state.db` + WS frames; never the truth | partialized to localStorage (prefs + resume keys only) |
| **Socket + subscriptions + seq** | [`src/store/ws.ts`](./src/store/ws.ts) `useWSStore` | hooks call `subscribe/on` | in-memory |
| **Appearance prefs** | `useThemeStore/useSkinStore/useFontSizeStore` | — | localStorage |

**The chat store is a projection, not a source of truth.** `state.db` is
the truth; `useChatStore` is a live reconstruction reconciled against the
DB (`reconcileSession`). The whole difficulty of the chat runtime comes
from keeping a projection coherent with an authoritative store that is
written *by another process at the end of the turn*. Treat that asymmetry
as the defining constraint, not an accident.

---

## 4. Data flow & event flow

**Run lifecycle** (full detail in `docs/ARCHITECTURE.md`):

```
Composer.send → POST /api/runs (202 {run_id})
             → useRunsStream.attachRun → WS subscribe run:<run_id>
server: start_run → _run_to_completion (asyncio task)
             → semaphore → build AIAgent on worker thread
             → register approval bridge → run_conversation in executor
             → callbacks broadcast_threadsafe: message.delta / stream.reset /
               reasoning.available / tool.started / tool.completed
             → terminal run.completed | run.failed | run.cancelled (carries session_id, usage)
client: dispatch by event → mutate the single turn bubble → on terminal:
             setFinalContent, patch tool results from DB, invalidate sessions
```

**Resumability & recoverability** are first-class:

- Each per-run frame is `seq`-stamped and buffered in a **512-frame replay
  ring** (`RunHandle.ring`). On reconnect the client re-subscribes with
  `last_seq`; the server replays the gap; the client dedups on `seq`.
- `activeRunId` + `runningBySession` are persisted, so a refresh or a
  session switch **re-attaches** a still-running run instead of orphaning
  it.
- The client re-verifies run status via `GET /api/runs/{id}` after any WS
  outage (it may have missed the terminal frame).

**Event flow (discovery):** backend resource changes broadcast
`discovery.changed`; `useDiscoveryWatcher` maps the resource string to a
React Query key and invalidates it. New resources need no frontend type
change (the resource is a kebab string).

**Approval flow:** upstream blocks the agent worker thread in
`event.wait()`; `ApprovalBridge` converts the notify callback into an
`approval.requested` WS frame; the user's `approval.resolve` wakes the
thread via `resolve_gateway_approval`. The same run continues — **no
synthetic message is injected.** `"always"` persistence happens *inside
upstream*; Station does not double-write the allowlist.

---

## 5. Forbidden boundaries (architectural invariants)

These are not preferences. A change that crosses one of these is wrong
even if it passes tests.

1. **No `hermes_*` import outside [`upstream_shim.py`](./server/lib/upstream_shim.py).**
   The shim is the only door. (Lint-enforced.)
2. **No raw write to `state.db`.** Reads are read-through; the only
   mutations are upstream-public `set_session_title` / `delete_session`.
   No `INSERT`/`UPDATE`, no schema assumptions, no `source` flips (upstream
   stamps `source="hms"` natively).
3. **No second source of truth for the transcript.** `useChatStore` is a
   projection of `state.db`. UI must never persist transcript content as
   if it were authoritative (only resume *keys* — `activeRunId`,
   `runningBySession` — are persisted).
4. **No business logic in [`adapter.py`](./server/adapter.py).** The
   adapter is a thin lifecycle shell (connect/disconnect/start aiohttp).
   `send()` is intentionally unused — Station delivers over REST/WS.
5. **No inlined upstream literals** (ports, labels, paths). Use the
   wrapper modules. (Lint-enforced.)
6. **The WS vocabulary is closed and versioned.** Unknown inbound types
   are dropped; new types follow the documented procedure and are mirrored
   in `ws-types.ts`. No silent additions.
7. **One run-status vocabulary.** A run's lifecycle states are a single
   closed set across the server, the WS frames, and the TS types. (This
   invariant is currently *violated* — see `PROJECT_CONSTITUTION.md` §3 —
   and must be repaired, not extended.)
8. **Degrade, never assume.** Any feature reaching upstream must have a
   capability flag and a defined behavior when the symbol is absent.
9. **No new open port in dev.** Dev backend binds a Unix socket; Vite is
   the only TCP listener. Don't reintroduce a dev TCP port.

---

## 6. Where the model is under tension (read before extending)

The architecture is sound, but two seams carry the system's complexity and
are the places future work most easily destabilizes:

- **Two run paths (contract unified in the 2026-05-30 run-model pass).** `start_run` (AIAgent:
  full streaming/tools/approvals/usage/auto-title) and `start_slash_run`
  (gateway `_handle_message`: a single `message.delta` + terminal frame).
  Their *executions* are intentionally distinct — one streams an agent run,
  the other awaits a one-shot gateway handler — but their *contract* is now
  unified: both emit terminals through the single `_terminal_frame()` helper
  (same shape, always carrying `session_id`), share the
  `queued → running → completed/failed/cancelled` status vocabulary, and
  clean up identically. The remaining event-richness gap (slash has no
  tool/reasoning/usage frames) is inherent to one-shot commands, not a
  defect. **Any third path must emit terminals via `_terminal_frame()`.**
- **Transcript reconciliation.** [`useRunsStream.ts`](./src/hooks/useRunsStream.ts)
  + [`chat.ts`](./src/store/chat.ts) carry the projection-vs-truth
  reconciliation. The "clear the trailing streaming bubble" operation —
  once inlined across 4 control-flow paths (reconnect guard, terminal
  frame, resume-on-mount, stop) — now funnels through the single
  `settleStreamingMessage()` store reducer; every run terminal/abort path
  calls it, so the reduction lives in one place (pinned by `chat.test.ts`).
  **Any new run terminal/abort path must settle through that reducer, not
  re-inline the tail walk.**
