# Hermes Station — Development Guide

For runtime topology + WS contract see [ARCHITECTURE.md](./ARCHITECTURE.md).
For install paths see [PLUGIN_INSTALL.md](./PLUGIN_INSTALL.md).

## Prerequisites

- `hermes-agent` checked out at `~/.hermes/hermes-agent` with a working
  venv at `~/.hermes/hermes-agent/venv`.
- Node 20+ and `pnpm` 9+ for the SPA.

## Runtime modes

| Mode | How | Visibility |
|---|---|---|
| **gateway-loaded** | `hms install` → `hermes gateway restart` | Adapter runs in-process; appears on the Dashboard. Required for `set_session_vars` / kanban notifier / etc. |
| **dev** | `pnpm dev` (= `hms dev`) | Vite HMR on :3131 + a standalone aiohttp backend on a Unix socket; hot-reload friendly but invisible to the gateway / Dashboard. |

## One-time setup

```bash
pnpm install
hms install
```

## Daily dev loop

```bash
pnpm dev          # Vite :3131 + backend on a Unix socket (also via `hms dev`)
```

Dev uses a **single TCP port, :3131** (Vite). The Python backend listens
on a Unix socket (`~/.hermes/run/station-dev.sock`) instead of a port,
so it never clashes with the production gateway (TCP **:1313**); Vite
proxies `/api/*` + `/ws` to that socket and the browser only ever opens
`:3131`. Override the socket with `HMS_DEV_SOCK=<path> pnpm dev`, or run
a TCP backend directly with `hms dev --port <N>`. Use a different Python:

```bash
HMS_PYTHON=/path/to/python pnpm dev
```

## Smoke scripts

These exercise a running backend. By default they target the dev Unix
socket (`HMS_DEV_SOCK`, which `pnpm dev` exports); set `HMS_PORT=<N>` to
hit a TCP backend instead (`hms dev --port N`, or production on 1313).

```bash
~/.hermes/hermes-agent/venv/bin/python scripts/smoke_api_routes.py
~/.hermes/hermes-agent/venv/bin/python scripts/smoke_run_ws.py
~/.hermes/hermes-agent/venv/bin/python scripts/smoke_approval_bridge.py
```

## Running tests

Unit tests import upstream `hermes-agent` modules (`tools`, `gateway`,
`run_agent`, …) and need their third-party deps (fastapi, aiohttp, …).
The repo's local `venv/` has neither, so a bare `pytest` fails with
`ModuleNotFoundError: No module named 'tools'`. Run them with the
**hermes-agent venv** instead — `scripts/test.sh` discovers it the same
way `dev.sh` does (`HMS_PYTHON` > `~/.hermes/hermes-agent/venv` >
system) and forwards any args to pytest:

```bash
bash scripts/test.sh                      # full suite
bash scripts/test.sh tests/unit/test_ws.py -q
HMS_PYTHON=/path/to/python bash scripts/test.sh
```

## "No hardcoding" guardrails

Don't type these literals in `server/` — use the wrapper instead:

| Don't | Do |
|---|---|
| `"~/.hermes"` / `Path.home() / ".hermes"` | `server.lib.upstream_paths.hermes_home()` |
| `"ai.hermes.gateway"` | `server.lib.upstream_paths.launchd_label()` |
| `"hermes-gateway.service"` | `server.lib.upstream_paths.systemd_service_name()` |
| `"state.db"` / hardcoded path | `server.lib.upstream_paths.state_db_path()` |
| `1313` | `server.lib.config_reader.hms_port()` |
| `9119` | `server.lib.config_reader.dashboard_url()` |
| literal `["minimal", "low", …]` | `from hermes_constants import VALID_REASONING_EFFORTS` |

`bash scripts/lint_no_hardcoding.sh` enforces the path / port / label
rows in CI (it also rejects any `from {hermes_cli,gateway,tools,run_agent,
hermes_constants,hermes_state}` import outside `upstream_shim.py`).

## Code layout cheatsheet

```
server/
├── __init__.py             register(ctx) entry point
├── __main__.py             `python -m server` → cli.main
├── adapter.py              StationAdapter(BasePlatformAdapter)
├── app.py                  aiohttp Application factory + middleware + SPA mount
├── app_keys.py             typed aiohttp app[...] keys
├── approvals.py            4-choice approval bridge
├── auth.py                 cookie + argon2 + localhost trust
├── capabilities.py         fs / dashboard / agent probe
├── cli.py                  `hms` entry point (install/dev/status/restart/...)
├── csrf.py                 X-HMS-CSRF guard
├── lifecycle.py            launchd/systemd + plugin install re-exports
├── runs.py                 start_run + RunRegistry + AIAgent callbacks
├── settings.py             config.yaml mutation
├── ws.py                   WSManager + WSConnection
├── ws_dispatch.py          @register table for inbound WS domain verbs
├── lib/
│   ├── argon2_hash.py      hash/verify password
│   ├── config_reader.py    config.yaml-derived values
│   ├── dashboard_supervisor.py  spawn/watchdog the dashboard sidecar
│   ├── plugin_install.py   symlink + enable_in_config + status
│   ├── route_helpers.py    SESSION_ID_RE + coerce_int_arg (shared)
│   ├── session_store.py    station/sessions.json (chmod 0o600)
│   ├── state_db.py         thin singleton wrapping hermes_state
│   ├── upstream_paths.py   paths / labels
│   ├── upstream_shim.py    single boundary to hermes-agent
│   ├── workspace_cwd.py    align agent TERMINAL_CWD with active workspace
│   └── yaml_edit.py        comment-preserving YAML mutation
├── middleware/             host_guard / cors / rate_limit / security_headers
└── routes/                 allowlist · analytics · approvals · chat · config ·
                            dashboard_proxy · files · kanban · lifecycle · login ·
                            logs · models · password · plugins · profiles ·
                            projects · runs · settings · skills_content · upload · ws
                            (chat.py = merged sessions + messages + search)
src/                        React 19 SPA (Vite + Zustand + react-query)
tests/                      pytest (unit/ + e2e/ + integration/); run via scripts/test.sh
scripts/
├── dev.sh                  launches Vite + Python backend (`python -m server dev`)
├── test.sh                 runs pytest under the hermes-agent venv
├── install_plugin.sh       legacy shell installer (same shape as `hms install`)
├── lint_no_hardcoding.sh   CI lint
└── smoke_*.py              live-server smoke checks
```

## Approval bridge

`tools.approval` blocks the agent worker thread in `event.wait()` when
a dangerous command needs approval. Station's `ApprovalBridge`:

1. Registers a notify callback per session — converts the sync call
   into a WS broadcast on the `approval` channel.
2. Maintains a `pending` mirror; new WS subscribers get a replay so a
   tab refresh during a prompt doesn't strand the agent thread.
3. Resolves via `resolve_gateway_approval(session_key, choice)`. The
   four choices are `once / session / always / deny`.

## Lifecycle endpoints

```text
GET  /api/lifecycle/status            → {plugin, gateway, platform}
POST /api/lifecycle/gateway/restart   → 202 (signalled) | 409 (not running)
```

`POST .../restart` delivers SIGUSR1 to the gateway PID. The Settings
panel's restart button uses this; it then polls `lifecycle/status` to
confirm the PID rolled, with a 6 s "quiet" window so the polling
doesn't flood console with `ERR_CONNECTION_REFUSED` while the adapter
is offline.

## Cleanup

```bash
hms uninstall                       # symlinks + platforms.station
hermes gateway restart              # reload without us
~/.hermes/hermes-agent/venv/bin/python -m pip uninstall hermes-station
```
