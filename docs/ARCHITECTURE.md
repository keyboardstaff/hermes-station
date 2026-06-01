# Architecture

This document covers the runtime topology, the request lifecycle for
chat + approvals, and the "no hardcoding" boundary.

For installation see [PLUGIN_INSTALL.md](./PLUGIN_INSTALL.md). For
dev setup and per-feature notes see [DEVELOPMENT.md](./DEVELOPMENT.md).

## Process topology

```text
Browser
  ┌───────────────────────────────────────────────────┐
  │  React SPA  (Vite dev :3131 / built dist/)        │
  │   React Query + Zustand stores                    │
  │   Single WebSocket via useWSStore                 │
  └─────────────────┬─────────────────────────────────┘
                    │  fetch /api/*   + WebSocket /ws
       Vite dev    │       (dev: browser → :3131 → proxy → unix socket;
       reverse-    │        prod: browser → :1313 direct)
       proxies     ▼
  ┌───────────────────────────────────────────────────┐
  │  Station backend (aiohttp; prod TCP :1313 /        │
  │                   dev Unix socket, no TCP port)    │
  │   middleware:                                     │
  │     host_guard → cors → rate_limit →              │
  │     security_headers → auth → csrf                │
  │   routes/*: sessions, runs, approvals,            │
  │             settings, password, memory, logs,     │
  │             lifecycle, dashboard_proxy, ws        │
  └─────────────────┬─────────────────────────────────┘
                    │  in-process Python imports
                    ▼
  ┌───────────────────────────────────────────────────┐
  │  hermes-agent gateway (same Python interpreter)    │
  │   gateway/run.py: GatewayRunner                   │
  │   tools/approval.py: 4-choice dangerous-cmd flow  │
  │   hermes_state.SessionDB: sqlite + FTS5           │
  │   run_agent.AIAgent: streaming + tool dispatch    │
  └───────────────────────────────────────────────────┘
                    │  forwards admin/analytics
                    ▼
  ┌───────────────────────────────────────────────────┐
  │  hermes_cli.web_server (Dashboard, optional)      │
  │   FastAPI, runs separately on its own port        │
  └───────────────────────────────────────────────────┘
```

Two facts worth pinning:

1. **Single Python process for plugin + agent.** The plugin runs inside
   the same `hermes-agent gateway run` process as `GatewayRunner` and
   `AIAgent`. There is no IPC bridge — function calls.
2. **Dashboard is separate.** It's a different FastAPI process at
   port 9119 (configurable). The plugin's `/api/dashboard/*` route
   transparently proxies to it. We never speak the dashboard protocol
   ourselves.

## Trust model

The middleware chain (`host_guard → cors → rate_limit →
security_headers → auth → csrf`) is built for **a single trusted user
on a trusted host**, not multi-tenant isolation:

* **Loopback is fully trusted.** `auth.is_localhost` returns true for
  any `127.0.0.0/8` / `::1` socket, and `auth_middleware` then skips the
  password/cookie check entirely. Every local process and local user can
  drive the agent — which executes arbitrary shell commands. The
  dangerous-command approval flow is a UX guardrail, **not** a sandbox.
* **Password gates only non-loopback.** `password_hash` is required
  before `host: 0.0.0.0`; LAN clients must `POST /api/login` for an
  `hms_session` cookie. CSRF is enforced by requiring the `X-HMS-CSRF`
  header on mutating verbs (a header cross-origin forms can't set).
* **Reverse-proxy caveat.** `is_localhost` only honors
  `X-Forwarded-For` when the socket itself is loopback (the Vite dev
  proxy hop). A misconfigured production proxy that forwards LAN traffic
  over loopback *without* a correct `X-Forwarded-For` would have those
  requests classified as trusted-localhost. Set XFF correctly.

## Chat lifecycle (run + WS stream)

```text
SPA (Composer.send)
  │
  ▼  POST /api/runs  {input, session_id?, model?, reasoning_effort?}
  │  status 202, body {run_id, session_id, status:"queued"}
  │
  ▼  WS subscribe  channel = "run:<run_id>"
  │
  │      ┌─────────────────── server side ──────────────────────┐
  │      │ start_run schedules _run_to_completion as asyncio    │
  │      │ task. The task:                                      │
  │      │   1. Acquires the max_concurrent_runs semaphore      │
  │      │   2. Builds AIAgent on a worker thread (heavy import)│
  │      │   3. Registers approval bridge for the session       │
  │      │   4. Runs agent.run_conversation in executor         │
  │      │   5. broadcast_threadsafe fires for every:           │
  │      │        - stream_delta_callback  → message.delta      │
  │      │        - tool_start_callback    → tool.started       │
  │      │        - tool_complete_callback → tool.completed     │
  │      │        - reasoning_callback     → reasoning.available│
  │      │   6. Final run.completed / run.failed                │
  │      └──────────────────────────────────────────────────────┘
  │
  ▼  WS frames arrive in order. SPA's useRunsStream:
     - message.delta     → appendDelta() into the streaming bubble
     - tool.started      → appendToolCallPart(running)
     - tool.completed    → upsertToolCall(done|error)
     - run.completed     → mark non-streaming, refetch tool results
```

Source pointers:

* `server/routes/runs.py:create_run` — POST handler, validates input
* `server/runs.py:_run_to_completion` — the task body
* `server/runs.py:_build_agent` — AIAgent construction + 4 callbacks
* `server/ws.py:WSManager.broadcast_threadsafe` — worker-thread → loop bridge
* `src/hooks/useRunsStream.ts:useRunsStream` — client-side frame dispatch

## Approval bridge (dangerous-command 4-choice)

```text
AIAgent thread                       UI                       upstream tools/approval
       │                              │                               │
       │  check_all_command_guards    │                               │
       ├─────────────────────────────────────────────────────────────►│
       │                              │  registers _ApprovalEntry,    │
       │                              │  calls notify_cb(approval)    │
       │                              │◄──────────────────────────────┤
       │                              │  ApprovalBridge converts to   │
       │                              │  WS frame on "approval" and   │
       │                              │  "run:<id>" channels          │
       │                              │                               │
       │  entry.event.wait()          │                               │
       │  ...blocked...               │                               │
       │                              │  user clicks once / session / │
       │                              │  always / deny                │
       │                              ├──► WS approval.resolve ──►    │
       │                              │                               │
       │                              │     resolve_gateway_approval  │
       │                              │     sets entry.result + .set()│
       │                              ◄─────────────────────────────  │
       │                                                              │
       │  entry.event.is_set() → entry.result                        │
       ◄──────────────────────────────────────────────────────────────│
       │  Continue (allowed) or BLOCKED string (denied/timeout)       │
```

Key invariants:

* The agent's run is **the same** before and after — no fake user
  message is synthesised. Upstream blocks in `event.wait()`, we wake it
  with `resolve_gateway_approval`, the existing tool call returns.
* `"always"` persistence happens inside upstream (`save_permanent_allowlist`).
  We don't double-write to `command_allowlist`.
* The contextvar `set_current_session_key` is bound on the *worker
  thread*, not in the asyncio loop — see `server/runs.py:_run_in_thread`.

Source pointers:

* `server/approvals.py:ApprovalBridge` — notify_cb / resolve / contextvar
* `server/routes/approvals.py:_ws_approval_resolve` — WS inbound handler (`@register`)
* `server/routes/approvals.py` — REST fallback
* `src/hooks/useApprovalBridge.ts` — client-side handler + send

## WebSocket contract

The full frame vocabulary — every `{ "type": "<domain>.<verb>", ... }`
in both directions, the channel each rides on, and the rules for adding
a new type — lives in **[WS_PROTOCOL.md](./WS_PROTOCOL.md)** and is
mirrored in `src/lib/ws-types.ts`. That is the source of truth; this
section only covers the runtime mechanics behind it.

Verbs are namespaced: `ws.subscribe` / `ws.unsubscribe` /
`ws.ping` (inbound infra), `run.stop` / `approval.resolve` (inbound
domain), `ws.pong` / `run.event` / `approval.requested` (outbound).
There are no legacy `subscribe` / `stop` / `ping` aliases.

Wildcards: `*` subscribes to all channels; `run:*` subscribes to all
runs (prefix match). The manager prefix-matches in `WSConnection.is_subscribed`.

Queue overflow: each connection's outbound queue caps at
`server.ws.SEND_QUEUE_MAX` (256) frames; on overflow we drop oldest.
Per-run frames are also buffered in a 512-frame replay ring
(`RunHandle.ring`) so a client that reconnects and re-subscribes with
`last_seq` gets the gap re-sent. The client reconnects on disconnect
with exponential backoff (the SPA's `useWSStore`).

Heartbeat: server-side aiohttp ping every `server.ws.HEARTBEAT_SECONDS`
(20s); the client sends its own `ws.ping` on the same interval
(`src/store/ws.ts`).

## State.db ownership

`hermes_state.SessionDB` (the sqlite + FTS5 store under
`$HERMES_HOME/state.db`) is **owned by hermes-agent**. We never write
to it directly:

* On run start we pass `platform="hms"` and `session_db=db()`
  into `AIAgent`, and upstream stamps `sessions.source = "hms"`
  natively. No post-hoc flips.
* Our REST routes (`/api/sessions`, `/api/sessions/{id}/messages`,
  `/api/search`) call `list_sessions_rich` / `get_messages` /
  `search_messages` — read-through only.
* `PATCH /api/sessions/{id}` uses `set_session_title`; deletion uses
  `delete_session`. Both upstream-public APIs.

## "No hardcoding" boundary

Every upstream-owned literal (path, port, label, ID) flows through one
of two wrapper modules:

| Wrapper | Owns | Examples |
|---------|------|----------|
| `server.lib.upstream_paths` | filesystem paths + service labels | `hermes_home()`, `state_db_path()`, `launchd_label()`, `systemd_service_name()`, `venv_python()`, `plugins_root()` |
| `server.lib.config_reader` | config.yaml-derived values | `hms_host()`, `hms_port()`, `dashboard_url()`, `dashboard_token()`, `max_concurrent_runs()` |

CI enforces this via `scripts/lint_no_hardcoding.sh`. The forbidden
literals (and the wrapper each redirects to) are: `1313` → `hms_port()`,
`9119` → `dashboard_url()`, `ai.hermes.gateway` → `launchd_label()`,
`hermes-gateway.service` → `systemd_service_name()`, `"~/.hermes"` and
`Path.home()/".hermes"` → `hermes_home()`. The same script also rejects
any `from {hermes_cli,gateway,tools,run_agent,hermes_constants,hermes_state}`
import outside `server/lib/upstream_shim.py`.

`upstream_paths.hermes_home()` is **hardened against unexpanded env
vars**: even if `HERMES_HOME=~/.hermes` (literal, what
upstream's `get_hermes_home` returns verbatim), we
`.expanduser().resolve()` so no caller can accidentally create a
relative `./~/.hermes` directory.

## File layout cheatsheet

```text
hermes-station/
├── server/                       Python plugin
│   ├── __init__.py            register(ctx)
│   ├── __main__.py            `python -m server` → cli.main (dev launcher)
│   ├── adapter.py             StationAdapter(BasePlatformAdapter)
│   ├── app.py                 aiohttp.Application factory + middleware + SPA mount
│   ├── app_keys.py            typed aiohttp app[...] keys
│   ├── approvals.py           ApprovalBridge
│   ├── auth.py                cookie + argon2 + localhost trust
│   ├── capabilities.py        fs / dashboard / agent probe
│   ├── cli.py                 `hms` entry point (install/dev/status/restart/...)
│   ├── csrf.py                X-HMS-CSRF guard
│   ├── lifecycle.py           launchd/systemd + plugin install re-exports
│   ├── runs.py                start_run + RunRegistry + AIAgent callbacks
│   ├── settings.py            config.yaml mutation
│   ├── ws.py                  WSManager + WSConnection
│   ├── ws_dispatch.py         @register table for inbound WS domain verbs
│   ├── lib/
│   │   ├── argon2_hash.py     hash_password / verify_password
│   │   ├── config_reader.py   single point for config-derived values
│   │   ├── dashboard_supervisor.py  spawn/watchdog the dashboard sidecar
│   │   ├── plugin_install.py  symlink + enable_in_config + status
│   │   ├── route_helpers.py   shared arg coercion + id validators
│   │   ├── session_store.py   station/sessions.json (chmod 0o600)
│   │   ├── state_db.py        thin singleton wrapping hermes_state
│   │   ├── upstream_paths.py  single point for paths/labels
│   │   ├── upstream_shim.py   ONLY allowed importer of hermes_* internals
│   │   ├── workspace_cwd.py   align agent TERMINAL_CWD with active workspace
│   │   └── yaml_edit.py       comment-preserving YAML mutation
│   ├── middleware/            host_guard / cors / rate_limit / security_headers
│   └── routes/                allowlist / analytics / approvals / chat / config /
│                              dashboard_proxy / files / kanban / lifecycle / login /
│                              logs / models / password / plugins / profiles /
│                              projects / runs / settings / skills_content / upload / ws
│                              (chat.py = merged sessions + messages + search)
├── src/                       React SPA (Vite + React 19 + Zustand)
├── tests/unit/                aiohttp + monkeypatched HERMES_HOME; tests/e2e + integration
├── scripts/                   dev.sh / install_plugin.sh / lint_no_hardcoding.sh / smoke_*.py
├── docs/                      this file + WS_PROTOCOL.md + PLUGIN_INSTALL.md + DEVELOPMENT.md
├── plugin.yaml                discovery manifest
├── pyproject.toml             hatchling build + console_script hms
└── package.json               pnpm workspace, no Node backend
```
