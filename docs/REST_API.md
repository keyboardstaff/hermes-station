# Hermes Station REST API

> Status: stable. The live-update channel is separate — see
> [`docs/WS_PROTOCOL.md`](./WS_PROTOCOL.md). Request/response TS types live in
> [`src/lib/`](../src/lib/) (`hermes-types.ts`, `api.ts`) and the per-domain
> hooks in [`src/hooks/`](../src/hooks/).

Station serves a single-origin HTTP API under **`/api/*`** (plus the `/ws`
WebSocket and the SPA on `/`). Everything is JSON in / JSON out unless noted
(`/api/upload` is multipart; `/api/files/read` can return base64). This
document is the single source of truth for the REST surface — **~92 endpoints
across 21 route modules** ([`server/routes/`](../server/routes/)) (90 via
`@router` decorators + the `analytics` / `dashboard_proxy` routes registered
with `app.router.add_*`), each `attach(app)`-ed in
[`app.py`](../server/app.py).

---

## Cross-cutting contract

These apply to **every** `/api/*` request, enforced by the middleware chain in
[`app.py`](../server/app.py) (outermost → innermost):

`host_guard → cors → rate_limit → security_headers → auth → csrf`

### Auth ([`server/auth.py`](../server/auth.py))
- **Loopback is trusted.** Any request from `127.0.0.0/8` / `::1` (or the dev
  Unix socket) is fully authenticated — no password. This is the single-trusted-
  user model; see the README security boundary.
- **Password mode** (`password_hash` set) gates *non-loopback* access only: a
  valid `hms_session` cookie (HttpOnly, SameSite=Strict, Secure on https) is
  required, else **`401 {"error":"unauthorized"}"`**.
- **Public paths** (no auth): `GET /api/auth-status`, `POST /api/login`.

### CSRF ([`server/csrf.py`](../server/csrf.py))
- Every **state-mutating** verb (`POST/PUT/PATCH/DELETE`) must send header
  **`X-HMS-CSRF: 1`** (any non-empty value), else **`403
  {"error":"csrf_required"}"`**. Safe verbs (`GET/HEAD`) and the two public
  paths are exempt. `api.json()` in [`src/lib/api.ts`](../src/lib/api.ts)
  attaches it automatically.

### Rate limit ([`server/middleware/rate_limit.py`](../server/middleware/rate_limit.py))
- Per-IP, **100 req / 60 s** (XFF trusted only from loopback). Over budget →
  **`429 {"error":"rate_limit_exceeded"}"`** with `X-RateLimit-*` headers.

### Conventions
- **Errors:** non-2xx responses are `{"error": "<snake_case_code>"}`, sometimes
  with a `"detail"` string. Validation → `400`, missing → `404`, optimistic-lock
  mismatch → `409`, unprocessable → `422`, upstream missing → `503`.
- **Upload cap:** `client_max_size` = `max_upload_bytes` (caps-derived).
- **IDs:** `session_id` matches `SESSION_ID_RE` (`^[\w\-:.]{1,128}$`); profile
  names match `^[a-z0-9][a-z0-9_-]{0,63}$`.

---

## Domains

Grouped to mirror `ARCHITECTURE.md` §2. `{…}` = path param; ⚠ = mutating
(needs CSRF).

### Chat & runs — the live core

**Runs** ([`runs.py`](../server/routes/runs.py))
| Method | Path | Purpose |
|---|---|---|
| ⚠ POST | `/api/runs` | Start a run. Body: `input` (string \| content-parts), optional `session_id`, `model`, `provider`, `reasoning_effort`, `profile` (D17). Gateway-known slash text routes to the slash path. → `202 {run_id, session_id, status}`. |
| GET | `/api/runs/{run_id}` | Run status snapshot (`queued/running/completed/failed/cancelled` + usage). |
| GET | `/api/runs/{run_id}/transcript` | In-flight turn snapshot for re-attach (D27): `{status, seq, partial: {text, reasoning, tool_calls}}` — the durable accumulator the bounded replay ring may have evicted. `?since=<seq>` also returns buffered frames newer than seq. |
| ⚠ POST | `/api/runs/{run_id}/stop` | Cancel a run → `200 {ok}`. |

**Chat — sessions + messages + search** ([`chat.py`](../server/routes/chat.py))
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sessions` | List sessions (rich). `?limit=`. |
| GET | `/api/sessions/{session_id}` | One session's metadata. |
| ⚠ PATCH | `/api/sessions/{session_id}` | Rename / set fields (`title`). |
| ⚠ DELETE | `/api/sessions/{session_id}` | Delete a session. |
| GET | `/api/sessions/{session_id}/messages` | Messages. `?limit=`. |
| GET | `/api/search` | FTS over messages. `?q=&sort=`. |

**Approvals** ([`approvals.py`](../server/routes/approvals.py)) — the
tool-approval bridge (full flow over WS; see `WS_PROTOCOL.md`).
| Method | Path | Purpose |
|---|---|---|
| ⚠ POST | `/api/approvals/resolve` | Resolve a pending approval (`once/session/always/deny`). |

**Allowlist** ([`allowlist.py`](../server/routes/allowlist.py)) — persisted
command-approval rules.
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/allowlist` | List allow rules. |
| ⚠ POST | `/api/allowlist` | Add a rule. |
| ⚠ DELETE | `/api/allowlist/{pattern_key}` | Remove a rule. |

### Capability surfaces

**Models / providers / keys** ([`models.py`](../server/routes/models.py),
[`config.py`](../server/routes/config.py))
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/models` | Providers + models + default ([`config.py`](../server/routes/config.py)). |
| GET | `/api/models/openrouter-catalog` | Live OpenRouter search. `?q=`. |
| GET | `/api/models/context` | Context-window length. `?model=&provider=`. |
| GET | `/api/models/vision-check` | Does a model report vision? `?model=`. |
| GET | `/api/models/auxiliary` | Per-task auxiliary model slots. |
| ⚠ POST | `/api/models/assign` | Assign a model to `main`/`auxiliary`. |
| ⚠ POST | `/api/models/test/{provider}` | Connectivity test. |
| GET | `/api/models/keys` | API-key metadata (masked). |
| ⚠ POST | `/api/models/keys/reveal` | Reveal one key's value. |
| ⚠ PUT | `/api/models/keys` | Set a key. |
| ⚠ DELETE | `/api/models/keys` | Delete a key. |

**Skills & toolsets** ([`skills_content.py`](../server/routes/skills_content.py))
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/skills` | Installed skills (+category). |
| GET | `/api/toolsets` | Toolsets. |
| GET | `/api/dashboard/skills/{name}/content` | A skill's content (via dashboard data). |

**MCP servers** ([`mcp.py`](../server/routes/mcp.py)) — the configured
`mcp_servers` block (config layer; catalog git-install stays in the CLI).
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/mcp/servers` | List configured servers (transport / command / args / url / enabled). |
| ⚠ POST | `/api/mcp/servers` | Add a server (`stdio` command[+args] \| `http` url[+oauth]); 409 if it exists. |
| ⚠ PATCH | `/api/mcp/servers/{name}` | `{enabled}` toggle (comment-preserving). |
| ⚠ DELETE | `/api/mcp/servers/{name}` | Remove the entry. |

**Plugins & discovery** ([`plugins.py`](../server/routes/plugins.py))
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/discover/platforms` | Connected messaging platforms (Channels). |
| GET | `/api/discover/slash-commands` | Slash-command registry (Composer). |
| GET | `/api/discover/themes` | Available dashboard themes. |
| GET | `/api/config/yaml` | Raw active `config.yaml` (+sha256). |
| ⚠ PUT | `/api/config/yaml` | Write raw `config.yaml` (sha256 optimistic-lock). |
| ⚠ PUT | `/api/plugins/runtime-providers` | Update runtime providers. |

**Profiles** ([`profiles.py`](../server/routes/profiles.py)) — each profile is
its own `HERMES_HOME`.
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/profiles` | List profiles (+ `gateway_running`, model, …). |
| ⚠ POST | `/api/profiles` | Create (optional `clone_from`). |
| ⚠ PATCH | `/api/profiles/{name}` | Rename. |
| ⚠ DELETE | `/api/profiles/{name}` | Delete. |
| GET/⚠PUT | `/api/profiles/{name}/soul` | SOUL.md read/write. |
| GET/⚠PUT | `/api/profiles/{name}/memory/{tab}` | MEMORY/USER/etc. read/write. |
| GET | `/api/profiles/active` | Sticky vs current + `requires_restart`. |
| ⚠ POST | `/api/profiles/active` | Set the sticky active profile. |
| GET/⚠PUT | `/api/profiles/{name}/config` | Per-profile raw `config.yaml` (sha256 lock). |
| GET/⚠PUT | `/api/profiles/{name}/config/values` | Per-profile config as values / dot-path writes (Advanced FORM). |

**Settings / password / config** ([`settings.py`](../server/routes/settings.py),
[`password.py`](../server/routes/password.py), [`config.py`](../server/routes/config.py))
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/settings` | Station `platforms.station.extra.*` (password redacted). |
| ⚠ PUT/PATCH | `/api/settings` | Update Station limits/extras. |
| ⚠ POST | `/api/password` | Set/change/clear the password hash. |
| GET | `/api/config` | Merged config view. |

### Workspace

**Files** ([`files.py`](../server/routes/files.py)) — two whitelisted roots
(`hermes` / `workspace`); sensitive files filtered.
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/files/tree` | Dir listing. `?root=&path=`. |
| GET | `/api/files/read` | File contents (text or base64). |
| ⚠ PUT | `/api/files/write` | Write a file. |
| ⚠ DELETE | `/api/files/delete` | Delete. |
| ⚠ POST | `/api/files/rename` | Rename/move. |
| ⚠ POST | `/api/files/mkdir` | Create dir. |
| GET | `/api/files/git-info` | Branch / dirty / ahead-behind. |
| GET | `/api/files/log` | Git log for a path. |
| GET | `/api/files/show` | A blob at a revision. |
| GET | `/api/files/workspaces` | Workspace list + `active_id`. |
| ⚠ POST | `/api/files/workspaces` | Add a workspace. |
| ⚠ DELETE | `/api/files/workspaces` | Remove a workspace. |
| ⚠ PUT | `/api/files/workspaces/active` | Set active workspace (sets `TERMINAL_CWD`). |
| GET | `/api/files/workspace/active` | Agent's effective cwd + name (D18 chip). |

**Upload** ([`upload.py`](../server/routes/upload.py))
| Method | Path | Purpose |
|---|---|---|
| ⚠ POST | `/api/upload` | **multipart** image/audio/video/doc → `{url, name, mime, size, is_image, …}`. Optional `session_id` for refresh-recovery. |

**Projects & Kanban** ([`projects.py`](../server/routes/projects.py),
[`kanban.py`](../server/routes/kanban.py))
| Method | Path | Purpose |
|---|---|---|
| GET / ⚠POST | `/api/projects` | List / create projects. |
| ⚠ PUT / ⚠DELETE | `/api/projects/{project_id}` | Update / delete. |
| GET | `/api/kanban/boards` | Boards. |
| ⚠ POST | `/api/kanban/boards` | Create board. |
| GET | `/api/kanban/board/{slug}/tasks` | Board tasks. |
| ⚠ POST | `/api/kanban/board/{slug}/tasks` | Add task. |
| ⚠ PUT | `/api/kanban/tasks/{task_id}/status` | Move task. |
| ⚠ POST | `/api/kanban/board/{slug}/nudge` | Nudge the agent on a board. |

### Observability & lifecycle

**Analytics & logs** ([`analytics.py`](../server/routes/analytics.py),
[`logs.py`](../server/routes/logs.py))
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/analytics/sources` | Per-source usage/cost aggregates. |
| GET | `/api/fs/logs/{file}` | Tail a gateway log file. |

**Lifecycle** ([`lifecycle.py`](../server/routes/lifecycle.py)) — Station's
sanctioned process-supervision surface (see `ARCHITECTURE.md` §1).
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/lifecycle/status` | Gateway + dashboard snapshot. |
| ⚠ POST | `/api/lifecycle/gateway/restart` | Self-restart (SIGUSR1 → spawn fallback). |
| ⚠ POST | `/api/lifecycle/gateway/start` | Start a profile's gateway (`hermes -p <profile> gateway start`). |
| ⚠ POST | `/api/lifecycle/gateway/stop` | Stop a profile's gateway. |

**Auth** ([`login.py`](../server/routes/login.py))
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth-status` | `{requiresLogin, loggedIn, localhost}` (public). |
| ⚠ POST | `/api/login` | Exchange password for `hms_session` cookie (public). |
| ⚠ POST | `/api/logout` | Clear the cookie. |

### Dashboard proxy

**Transparent proxy** ([`dashboard_proxy.py`](../server/routes/dashboard_proxy.py))
| Method | Path | Purpose |
|---|---|---|
| * | `/api/dashboard/{tail}` | Forwards to `{dashboard_url}/api/{tail}` (scrapes the dashboard session token on 401). `/pty` is blocked. The SPA consumes upstream's config schema/defaults and a few read-models through here — **the only place Station speaks the Dashboard's protocol**, and it never adds new private-symbol coupling. |

### WebSocket
| Method | Path | Purpose |
|---|---|---|
| GET | `/ws` | The live channel. Frame contract: [`docs/WS_PROTOCOL.md`](./WS_PROTOCOL.md). |

---

## Keeping this in sync

- New route → add a row here in the same PR (the same discipline
  `WS_PROTOCOL.md` + `ws-types.ts` follow for WS frames).
- TS request/response types live in [`src/lib/hermes-types.ts`](../src/lib/hermes-types.ts);
  per-domain React-Query hooks in [`src/hooks/`](../src/hooks/) are the
  client-side contract.
- Counts above (90 endpoints / 21 modules) are a point-in-time check; the
  authoritative list is always `grep -rE '@router\.(get|post|put|patch|delete)'
  server/routes/` plus the two `app.router.add_*` routes in `analytics.py` /
  `dashboard_proxy.py`.
