# Capability Coverage — Station vs. hermes-agent

> **Purpose.** Station's north star (see `PROJECT_CONSTITUTION.md` §1) is to
> be the **complete** web client for `hermes-agent`'s gateway: every
> capability reachable from the CLI or a messaging platform should be
> reachable here. This document is the audited matrix of where we stand,
> so "complete" is a measurable target, not a slogan.
>
> Derived from a direct read of the upstream source at
> `~/.hermes/hermes-agent` (README + `config.yaml` top-level sections +
> `hermes_cli/commands.py` registry + `tools/` + `gateway/platforms/`).
> Upstream scale at audit time: **~20 messaging platforms, 70 slash
> commands (25 `cli_only`), 82 tool modules, 60+ `config.yaml` sections.**
>
> Last audited: 2026-05-30 (upstream ~v0.15.1).

## Legend

| Mark | Meaning |
|---|---|
| ✅ | **Full** — first-class structured UI in Station |
| ◐ | **Partial** — reachable but incomplete (display-only, file-level, or missing sub-features) |
| ✗ | **Missing** — upstream has it; Station has no dedicated UI (the raw `config.yaml` editor is the only fallback) |
| ⊘ | **Out of scope** — correctly *not* a web-client concern (research/CLI/editor/terminal surfaces) |

> **The universal fallback.** Settings → Advanced exposes a raw
> `config.yaml` editor (`ConfigYamlEditor`). So almost nothing is strictly
> *impossible* — but a raw-YAML escape hatch is not "complete." Every ✗ /
> ◐ below is a gap measured against **first-class structured UI**, which is
> the bar "complete web client" sets.

---

## 1. Conversation & runtime

| Capability | Upstream | Station | Status |
|---|---|---|---|
| Chat / streaming runs | `run_agent.AIAgent` | `runs` + `ws` + `useRunsStream` | ✅ |
| Dangerous-command approval (4-choice) | `tools.approval` | `approvals` + `ApprovalDrawer` | ✅ |
| Command allowlist | `config.command_allowlist` | `allowlist` route | ✅ |
| Sessions list / rename / delete | `hermes_state.SessionDB` | `chat` route | ✅ |
| FTS5 message search | `SessionDB.search_messages` | `/api/search` + GlobalSearch | ✅ |
| Token usage / context ring | agent usage | Composer ring + `/usage` | ✅ |
| Slash commands | 70 cmds (25 `cli_only`) | ~45 gateway-dispatchable in SlashMenu | ✅ (cli-only correctly excluded) |
| Reasoning effort | `hermes_constants` | Composer selector | ✅ |
| Stop / interrupt run | `agent.interrupt` | `run.stop` | ✅ |
| **handoff / subagent delegation** | `delegation` toolset, `goals` | **GroupPanel** (handoff + subagent view) | ✅ |
| Conversation ops `/compress` `/retry` `/undo` | slash registry | only if gateway-dispatchable; no dedicated buttons | ◐ |
| `/personality` overlay switch | `agent.personalities` (see §7) | via SlashMenu only; no picker UI | ◐ |

## 2. Models & providers

| Capability | Upstream | Station | Status |
|---|---|---|---|
| Model / provider selection | `hermes_cli.model_switch` | `models` route + ModelsPanel | ✅ |
| API keys per provider/category | `config.providers` / `credential_pool` | KeyEditDialog / KeyRow | ✅ |
| Fallback model chain | `config.fallback_providers` | ModelChain | ✅ |
| Per-run provider override | `resolve_runtime_provider` | RunInput.provider | ✅ |
| Pareto / code router | OpenRouter plugin | ParetoSlider (capability-gated) | ✅ |
| **Nous Portal / Tool Gateway** | `hermes portal …` (OAuth, web/img/TTS/browser gateway) | — | ✗ |

## 3. Skills, plugins, tools

| Capability | Upstream | Station | Status |
|---|---|---|---|
| Browse / install skills (Skills Hub) | `tools.skills_tool`, `skills_hub` | `skills_content` + SkillsPanel | ✅ |
| Skill content view | `_find_all_skills` | SkillCard / install dialog | ✅ |
| Plugins (git install / runtime providers) | `hermes_cli.plugins` | `plugins` route + PluginsPanel | ✅ |
| Toolset enable/disable | `tools_config` | ToolsetCard | ✅ |
| Fine-grained agent tuning (`tool_output`, `tool_loop_guardrails`, `file_read_max_chars`, `code_execution`) | `config.*` | — (raw YAML only) | ✗ |
| **MCP server management** | `mcp_catalog` / `mcp_config` / `mcp_picker`, `optional-mcps/` | **`mcp` route + `McpServersView` (on /skills)** — list / enable / disable / remove / manually add (stdio+http) the configured `mcp_servers`; catalog git-install + OAuth login stay in the CLI | ◐ |
| Autonomous skill creation / `curator` | `config.curator`, skills self-improve | — (runs upstream; no UI surface) | ✗ |

## 4. Memory & identity

| Capability | Upstream | Station | Status |
|---|---|---|---|
| Persona file (SOUL.md) | profile `SOUL.md` | profiles route get/put SOUL | ✅ |
| Memory files (MEMORY.md / USER.md) | profile `memories/` | profiles route get/put memory | ✅ |
| Profiles (full HERMES_HOME) CRUD + sticky-active | `hermes_cli.profiles` | profiles route + ProfilePanel | ✅ |
| **Structured memory store** | `memory_store.db` (holographic), memory nudges | **`memory` route + `MemoryPanel`** — view + forget facts for the **holographic** provider's local store (D44); remote providers (honcho/mem0/…) degrade to a notice | ◐ |
| **Honcho dialectic user model** | `config.honcho`, `honcho` toolset | — | ✗ |

## 5. Automation & tasks

| Capability | Upstream | Station | Status |
|---|---|---|---|
| Cron jobs (CRUD / pause / trigger) | `hermes_cli.cron` | **via `/api/dashboard/cron/*` proxy** + CronPanel | ✅ |
| Kanban (boards / tasks / transitions) | `hermes_cli.kanban_db` | `kanban` route + KanbanPanel | ✅ |
| Files / workspace / versions | terminal + fs tools | `files` + `projects` + `upload` | ✅ |
| Image/audio/doc attachments | multimodal input | upload route + Composer | ✅ |
| **Context files** (project AGENTS.md that shapes turns) | `config.context` | partial via files/profile docs | ◐ |

## 6. Platforms, observability, lifecycle

| Capability | Upstream | Station | Status |
|---|---|---|---|
| Messaging platforms (~20) | `gateway/platforms/*` | ChannelsPanel — **status display only**; keys via `/models#keys` | ◐ |
| Per-platform full config (token + allowed users + working dir + pairing) | per-platform config | — (raw YAML / Channels deep-links) | ◐ |
| Analytics / usage / insights | dashboard analytics | `analytics` route + AnalyticsPanel | ✅ |
| Logs tail | log files | `logs` route + LogsPanel | ✅ |
| Gateway lifecycle (status / restart) | `hermes_cli.gateway` | `lifecycle` route | ✅ |
| Dashboard (admin) | `hermes_cli.web_server` | `dashboard_proxy` (+ Station supervises it) | ✅ |
| Security (password / CSRF / host guard) | — (Station-owned) | `auth` / `csrf` / `password` | ✅ |
| **Update** (`hermes update`) | `hermes_cli` updater | — | ✗ (minor) |

## 7. Profile ⊃ Personality — the verified relationship

Confirmed against upstream source (requested clarification):

- **Profile** = a *fully independent HERMES_HOME directory* — its own
  `config.yaml`, `.env`, `memory`, `sessions`, `skills`, `gateway`,
  `cron`, `logs`, and `SOUL.md` (`hermes_cli/profiles.py` module docstring).
  It is the **complete container** for one agent instance. Station manages
  these (CRUD + sticky-active + SOUL/MEMORY/USER editing).
- **Personality** = a **name → system-prompt-overlay** entry under
  `agent.personalities` in *that profile's* `config.yaml`
  (`hermes_cli/commands.py:1578-1586`: iterates
  `load_config().get("agent",{}).get("personalities",{}).items()` as
  `(name, prompt)`; `/personality` switches or clears the overlay).
- **Therefore personality is a containment subset, not a peer:**
  `Profile ⊃ config.yaml ⊃ agent.personalities`. A personality is a
  runtime-switchable prompt overlay *inside* a profile — distinct from the
  SOUL.md persona file and from the profile container itself.

**Coverage:** Profile container + SOUL.md + memory files are ✅. The
`agent.personalities` overlay set has no dedicated picker UI (only the
`/personality` slash path) → ◐. When built, it belongs **inside the
Profile panel** as an "advanced config subset," mirroring the upstream
containment — *not* as a top-level peer.

## 8. Correctly out of scope ⊘

Not gaps — these are CLI/research/editor/terminal surfaces a web client
should not absorb:

- Batch trajectory generation (`batch_runner.py`), trajectory compression
  (`trajectory_compressor.py`) — research tooling.
- ACP adapter (`acp_adapter/`) — editor (Zed) protocol.
- TUI (`ui-tui/`, `tui_gateway/`) — terminal UI.
- DM pairing security (`gateway/pairing.py`) — messaging-platform-side
  auth; Station has its own auth model.
- **Terminal backends** (local/docker/ssh/modal/daytona/singularity,
  `config.terminal`) — debatable; selecting a backend is arguably
  operator/CLI territory, but surfacing the *active* backend read-only
  would help. Tracked as a deferred decision, not a committed gap.

---

## 9. Gap-to-goal summary (feeds roadmap + debt D12)

Ordered by value for the "complete web client" goal:

1. **MCP server management** (✗) — highest-value missing integration.
2. **Per-platform full configuration** (◐) — make Channels a configure
   surface, not just a status board.
3. **Personality picker inside Profile panel** (◐) — low effort, closes a
   visible slash-only gap; respects the verified containment model.
4. **Structured memory store + Honcho** (✗) — surfaces the agent's
   self-curated identity, a headline upstream feature.
5. **Nous Portal / Tool Gateway** (✗) — one-subscription onboarding.
6. **Conversation ops** (`/compress`, `/retry`, `/undo`) as first-class
   buttons (◐).
7. Fine-grained agent tuning + curator visibility (✗) — advanced.

Every item above must still obey the boundary discipline: reached through
`upstream_shim` + a `CapabilityFlags` entry + graceful degradation. Note
that several (MCP, terminal, honcho) will deepen private-symbol coupling
(debt **D9**) — weigh that when scheduling.
