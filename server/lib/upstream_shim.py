"""Single-point boundary between server and hermes-agent internals.

Every `from hermes_cli/gateway/tools/run_agent/hermes_constants/hermes_state import ...`
outside this module is a CI lint violation (scripts/lint_no_hardcoding.sh).

Accessors return None on missing upstream symbols; consumers gate on shim.flags or handle None.
"""

from __future__ import annotations

import importlib
import logging
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


def _try_import(mod: str, attr: str | None = None) -> Any | None:
    """Best-effort fetch; returns None on missing module/attr, logs once."""
    try:
        m = importlib.import_module(mod)
    except Exception as exc:
        _warn_once(f"missing:{mod}", f"[hms.shim] cannot import {mod} — {exc}")
        return None
    if attr is None:
        return m
    val = getattr(m, attr, None)
    if val is None:
        _warn_once(f"missing:{mod}.{attr}", f"[hms.shim] {mod} has no attribute {attr}")
    return val


_warned: set[str] = set()


def _warn_once(key: str, msg: str) -> None:
    if key in _warned:
        return
    _warned.add(key)
    logger.warning(msg)


def _agent_root():
    """Hermes-agent source tree path via _try_import (testable through monkeypatched importlib)."""
    mod = _try_import("hermes_cli")
    if mod is None:
        return None
    from pathlib import Path
    return Path(mod.__file__).resolve().parent.parent


@dataclass
class CapabilityFlags:
    """SPA-facing snapshot of which upstream features are reachable.

    Never remove fields, only flip defaults.
    """

    agent_importable: bool = False
    approval_4_choice: bool = False
    session_db: bool = False
    gateway_lifecycle: bool = False
    base_platform_adapter: bool = False

    handoff_supported: bool = False
    subgoal_supported: bool = False
    vision_analyze_tool: bool = False
    x_search_tool: bool = False
    platform_circuit_breaker: bool = False
    cron_deliver_all: bool = False
    pareto_code_router: bool = False
    plugin_ctx_llm: bool = False
    skills_hf_tap: bool = False

    upstream_version: str | None = None
    station_version: str | None = None
    python_version: str = ""
    os_name: str = ""


@dataclass
class _RunAgent:
    AIAgent: type | None = field(
        default_factory=lambda: _try_import("run_agent", "AIAgent")
    )
    parse_reasoning_effort: Callable | None = field(
        default_factory=lambda: _try_import("hermes_constants", "parse_reasoning_effort")
    )


@dataclass
class _Gateway:
    find_gateway_pids: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.gateway", "find_gateway_pids")
    )
    request_self_restart: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.gateway", "_request_gateway_self_restart")
    )
    get_runtime_snapshot: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.gateway", "get_gateway_runtime_snapshot")
    )
    launchd_start: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.gateway", "launchd_start")
    )
    launchd_stop: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.gateway", "launchd_stop")
    )
    systemd_start: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.gateway", "systemd_start")
    )
    systemd_stop: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.gateway", "systemd_stop")
    )
    launchd_restart: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.gateway", "launchd_restart")
    )
    systemd_restart: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.gateway", "systemd_restart")
    )

    GatewayRunner: type | None = field(
        default_factory=lambda: _try_import("gateway.run", "GatewayRunner")
    )
    load_gateway_config: Callable | None = field(
        default_factory=lambda: _try_import("gateway.run", "_load_gateway_config")
    )
    resolve_gateway_model: Callable | None = field(
        default_factory=lambda: _try_import("gateway.run", "_resolve_gateway_model")
    )
    resolve_runtime_agent_kwargs: Callable | None = field(
        default_factory=lambda: _try_import("gateway.run", "_resolve_runtime_agent_kwargs")
    )
    resolve_runtime_provider: Callable | None = field(
        default_factory=lambda: _try_import(
            "hermes_cli.runtime_provider", "resolve_runtime_provider"
        )
    )
    get_platform_tools: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.tools_config", "_get_platform_tools")
    )

    Platform: type | None = field(
        default_factory=lambda: _try_import("gateway.config", "Platform")
    )

    def base_platform_adapter(self) -> type | None:
        """Late-bound: deferred past module load since upstream base pulls full agent runtime."""
        return _try_import("gateway.platforms.base", "BasePlatformAdapter")

    def send_result_cls(self) -> type | None:
        return _try_import("gateway.platforms.base", "SendResult")

    # Populated by __post_init__; wrapping under shim catches upstream renames at probe time.
    load_reasoning_config: Callable | None = None
    load_fallback_model: Callable | None = None

    def __post_init__(self) -> None:
        cls = self.GatewayRunner
        if cls is None:
            return
        for attr, dest in (
            ("_load_reasoning_config", "load_reasoning_config"),
            ("_load_fallback_model", "load_fallback_model"),
        ):
            fn = getattr(cls, attr, None)
            if fn is not None:
                object.__setattr__(self, dest, fn)
            else:
                _warn_once(
                    f"missing:GatewayRunner.{attr}",
                    f"[hms.shim] GatewayRunner has no attribute {attr}",
                )


@dataclass
class _Approval:
    resolve: Callable | None = field(
        default_factory=lambda: _try_import("tools.approval", "resolve_gateway_approval")
    )
    register_notify: Callable | None = field(
        default_factory=lambda: _try_import("tools.approval", "register_gateway_notify")
    )
    unregister_notify: Callable | None = field(
        default_factory=lambda: _try_import("tools.approval", "unregister_gateway_notify")
    )
    set_session_key: Callable | None = field(
        default_factory=lambda: _try_import("tools.approval", "set_current_session_key")
    )
    reset_session_key: Callable | None = field(
        default_factory=lambda: _try_import("tools.approval", "reset_current_session_key")
    )
    load_allowlist: Callable | None = field(
        default_factory=lambda: _try_import("tools.approval", "load_permanent_allowlist")
    )
    save_allowlist: Callable | None = field(
        default_factory=lambda: _try_import("tools.approval", "save_permanent_allowlist")
    )
    load_permanent: Callable | None = field(
        default_factory=lambda: _try_import("tools.approval", "load_permanent")
    )


@dataclass
class _State:
    SessionDB: type | None = field(
        default_factory=lambda: _try_import("hermes_state", "SessionDB")
    )


@dataclass
class _SessionContext:
    set_session_vars: Callable | None = field(
        default_factory=lambda: _try_import("gateway.session_context", "set_session_vars")
    )
    clear_session_vars: Callable | None = field(
        default_factory=lambda: _try_import("gateway.session_context", "clear_session_vars")
    )


@dataclass
class _Kanban:
    connect: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "connect")
    )
    list_tasks: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "list_tasks")
    )
    get_task: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "get_task")
    )
    list_boards: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "list_boards")
    )
    get_current_board: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "get_current_board")
    )
    write_txn: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "write_txn")
    )
    create_task: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "create_task")
    )
    create_board: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "create_board")
    )
    # "Nudge" — recompute which tasks are ready so the dispatcher picks them up.
    recompute_ready: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "recompute_ready")
    )
    VALID_STATUSES: frozenset | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "VALID_STATUSES")
    )
    # Transition helpers close active runs, append task_events, respect claim semantics —
    # prefer these over raw UPDATE so the dashboard audit trail stays consistent.
    complete_task: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "complete_task")
    )
    block_task: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "block_task")
    )
    unblock_task: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "unblock_task")
    )
    archive_task: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.kanban_db", "archive_task")
    )


@dataclass
class _Profiles:
    """Profile management — sticky-active + CRUD via upstream's Python API.

    Station runs in the same process as upstream's hermes_cli, so we
    skip the dashboard HTTP proxy and call these functions directly.
    Dashboard's HTTP layer strips fields like ``gateway_running`` from
    ``ProfileInfo``; the in-process path keeps the full dataclass.
    """

    get_active: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.profiles", "get_active_profile")
    )
    set_active: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.profiles", "set_active_profile")
    )
    get_active_name: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.profiles", "get_active_profile_name")
    )
    list_profiles: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.profiles", "list_profiles")
    )
    create_profile: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.profiles", "create_profile")
    )
    rename_profile: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.profiles", "rename_profile")
    )
    delete_profile: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.profiles", "delete_profile")
    )
    get_profile_dir: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.profiles", "get_profile_dir")
    )
    seed_profile_skills: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.profiles", "seed_profile_skills")
    )
    # Context-local HERMES_HOME override (ContextVar) — lets a single in-process
    # run re-scope to another profile's home without a restart, the same way
    # upstream's cron scheduler runs per-job profiles. Consumed by
    # ``server.lib.profile_run`` for the Composer profile pill (owner review D17).
    set_hermes_home_override: Callable | None = field(
        default_factory=lambda: _try_import("hermes_constants", "set_hermes_home_override")
    )
    reset_hermes_home_override: Callable | None = field(
        default_factory=lambda: _try_import("hermes_constants", "reset_hermes_home_override")
    )


@dataclass
class _Commands:
    """Slash command registry + resolver — single source of truth in v0.14.

    ``COMMAND_REGISTRY`` is the list of ``CommandDef``; ``resolve_command``
    handles aliases; ``is_gateway_known_command`` filters cli_only entries.
    """

    registry: Any = field(
        default_factory=lambda: _try_import("hermes_cli.commands", "COMMAND_REGISTRY")
    )
    resolve_command: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.commands", "resolve_command")
    )
    is_gateway_known: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.commands", "is_gateway_known_command")
    )


@dataclass
class _Models:
    list_authenticated_providers: Callable | None = field(
        default_factory=lambda: _try_import(
            "hermes_cli.model_switch", "list_authenticated_providers"
        )
    )
    list_picker_providers: Callable | None = field(
        default_factory=lambda: _try_import(
            "hermes_cli.model_switch", "list_picker_providers"
        )
    )
    get_capabilities: Callable | None = field(
        default_factory=lambda: _try_import(
            "agent.models_dev", "get_model_capabilities"
        )
    )
    lookup_context: Callable | None = field(
        default_factory=lambda: _try_import(
            "agent.models_dev", "lookup_models_dev_context"
        )
    )


@dataclass
class _Skills:
    find_all: Callable | None = field(
        default_factory=lambda: _try_import("tools.skills_tool", "_find_all_skills")
    )
    get_disabled: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.skills_config", "get_disabled_skills")
    )
    load_config: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.config", "load_config")
    )
    hub_lock_file: Callable | None = field(
        default_factory=lambda: _try_import("tools.skills_hub", "HubLockFile")
    )


@dataclass
class _Toolsets:
    list_configurable: Callable | None = field(
        default_factory=lambda: _try_import(
            "hermes_cli.tools_config", "_get_effective_configurable_toolsets"
        )
    )
    get_platform_tools: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.tools_config", "_get_platform_tools")
    )
    has_keys: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.tools_config", "_toolset_has_keys")
    )
    resolve: Callable | None = field(
        default_factory=lambda: _try_import("toolsets", "resolve_toolset")
    )
    load_config: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.config", "load_config")
    )


@dataclass
class _Mcp:
    """MCP server management — the *configured* ``mcp_servers`` block.
    We deliberately surface the config layer (list/enable/disable/
    remove/add a server entry), not the catalog git-install / OAuth flow, which
    stays in the CLI. ``installed_servers`` returns the live merged view."""

    installed_servers: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.mcp_catalog", "installed_servers")
    )
    list_catalog: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.mcp_catalog", "list_catalog")
    )
    is_enabled: Callable | None = field(
        default_factory=lambda: _try_import("hermes_cli.mcp_catalog", "is_enabled")
    )


def _normalize_platform(m: Any) -> dict:
    name = getattr(m, "value", None) or getattr(m, "name", None) or str(m)
    label = getattr(m, "label", None) or str(name).replace("_", " ").title()
    return {"name": str(name), "label": str(label), "kind": "builtin"}


@dataclass
class _Platforms:
    enum: type | None = field(
        default_factory=lambda: _try_import("gateway.config", "Platform")
    )
    registry: Any = field(
        default_factory=lambda: _try_import("gateway.platform_registry", "platform_registry")
    )

    def list_all(self) -> list[dict]:
        out: list[dict] = []
        if self.enum is not None:
            try:
                for m in self.enum:  # type: ignore[union-attr]
                    out.append(_normalize_platform(m))
            except Exception:
                logger.exception("[hms.shim] platforms.enum iteration failed")
        plugin_entries = getattr(self.registry, "plugin_entries", None)
        if callable(plugin_entries):
            try:
                # callable() narrows to a `() -> object` whose result pyright
                # treats as non-iterable; the registry call is dynamic, so type
                # the result Any to iterate the (possibly None) entry list.
                raw_entries: Any = plugin_entries()
                for entry in raw_entries or []:
                    out.append({
                        "name": str(getattr(entry, "name", "")),
                        "label": str(getattr(entry, "label", ""))
                        or str(getattr(entry, "name", "")),
                        "kind": "plugin",
                    })
            except Exception:
                logger.exception("[hms.shim] platforms.registry call failed")
        # Dedup by name, last write wins so plugin labels override builtin (i18n).
        merged: dict[str, dict] = {}
        for entry in out:
            merged[entry["name"]] = entry
        return sorted(merged.values(), key=lambda d: d["name"])


@dataclass
class _Slash:
    """Slash command discovery — reads upstream's COMMAND_REGISTRY (via _Commands)."""

    _commands: _Commands | None = None

    def list_available(self) -> list[dict]:
        registry = self._commands.registry if self._commands else None
        out: list[dict] = []
        for cmd in registry or ():
            # Station is a gateway client — skip cli_only entries unless
            # their gateway_config_gate is set.
            if getattr(cmd, "cli_only", False) and not getattr(cmd, "gateway_config_gate", None):
                continue
            out.append({
                "name": str(getattr(cmd, "name", "")),
                "description": str(getattr(cmd, "description", "")),
                "source": "builtin",
            })
        return out


@dataclass
class _Themes:
    _builtin: list[dict] | None = field(
        default_factory=lambda: _try_import(
            "hermes_cli.web_server", "_BUILTIN_DASHBOARD_THEMES"
        )
    )

    def list(self) -> list[dict]:
        return list(self._builtin or [])


@dataclass
class Shim:
    flags: CapabilityFlags = field(default_factory=CapabilityFlags)
    run_agent: _RunAgent = field(default_factory=_RunAgent)
    gateway: _Gateway = field(default_factory=_Gateway)
    approval: _Approval = field(default_factory=_Approval)
    state: _State = field(default_factory=_State)
    session_context: _SessionContext = field(default_factory=_SessionContext)
    models: _Models = field(default_factory=_Models)
    skills: _Skills = field(default_factory=_Skills)
    toolsets: _Toolsets = field(default_factory=_Toolsets)
    mcp: _Mcp = field(default_factory=_Mcp)
    profiles: _Profiles = field(default_factory=_Profiles)
    commands: _Commands = field(default_factory=_Commands)
    platforms: _Platforms = field(default_factory=_Platforms)
    slash: _Slash = field(default_factory=_Slash)
    themes: _Themes = field(default_factory=_Themes)
    kanban: _Kanban = field(default_factory=_Kanban)

    def __post_init__(self) -> None:
        # _Slash reads its registry through _Commands so both surfaces share one import.
        self.slash._commands = self.commands

    _probed: bool = False

    def probe(self, *, force: bool = False) -> CapabilityFlags:
        """Populate flags from the live upstream surface; idempotent unless force=True."""
        if self._probed and not force:
            return self.flags
        import platform as _plat

        f = self.flags
        f.agent_importable = self.run_agent.AIAgent is not None
        f.approval_4_choice = self.approval.resolve is not None
        f.session_db = self.state.SessionDB is not None
        f.gateway_lifecycle = self.gateway.find_gateway_pids is not None
        f.base_platform_adapter = self.gateway.base_platform_adapter() is not None

        f.handoff_supported = any(
            getattr(c, "name", None) == "handoff" for c in self.commands.registry or ()
        )
        f.subgoal_supported = _try_import("hermes_cli.goals") is not None
        f.vision_analyze_tool = _try_import("tools.vision_tools") is not None
        f.x_search_tool = _try_import("tools.x_search_tool") is not None
        # Per-platform circuit breaker is exposed as the internal
        # GatewayRunner._pause_failed_platform method (used by the reconnect
        # watcher and the /platform pause|resume slash command).
        gw_runner = _try_import("gateway.run", "GatewayRunner")
        f.platform_circuit_breaker = (
            gw_runner is not None and hasattr(gw_runner, "_pause_failed_platform")
        )
        f.cron_deliver_all = _try_import("hermes_cli.cron") is not None
        # OpenRouter + HF skill tap ship as plugin/skill directories, not importable modules.
        agent_root = _agent_root()
        f.pareto_code_router = (
            agent_root is not None
            and (agent_root / "plugins" / "model-providers" / "openrouter").is_dir()
        )
        plugin_ctx_cls = _try_import("hermes_cli.plugins", "PluginContext")
        f.plugin_ctx_llm = (
            plugin_ctx_cls is not None and hasattr(plugin_ctx_cls, "llm")
        )
        f.skills_hf_tap = (
            agent_root is not None
            and (agent_root / "skills" / "mlops" / "huggingface-hub").is_dir()
        )

        f.python_version = sys.version.split()[0]
        f.os_name = _plat.system()
        f.upstream_version = _detect_upstream_version()
        f.station_version = _detect_station_version()

        self._probed = True
        return self.flags

    def to_dict(self) -> dict:
        return {**self.flags.__dict__}

    def reset_for_test(self) -> None:
        self.flags = CapabilityFlags()
        self.run_agent = _RunAgent()
        self.gateway = _Gateway()
        self.approval = _Approval()
        self.state = _State()
        self.session_context = _SessionContext()
        self.models = _Models()
        self.skills = _Skills()
        self.toolsets = _Toolsets()
        self.mcp = _Mcp()
        self.profiles = _Profiles()
        self.commands = _Commands()
        self.platforms = _Platforms()
        self.slash = _Slash(_commands=self.commands)
        self.themes = _Themes()
        self.kanban = _Kanban()
        self._probed = False
        _warned.clear()


def _detect_upstream_version() -> str | None:
    """importlib.metadata (wheel) then hermes_constants.__version__ (source layout)."""
    try:
        import importlib.metadata as md
        return md.version("hermes-agent")
    except Exception:
        pass
    try:
        from hermes_constants import __version__  # type: ignore[import-not-found]
        return str(__version__)
    except Exception:
        return None


def _detect_station_version() -> str | None:
    """Hermes Station's own package version (pyproject ``[project].version``)."""
    try:
        import importlib.metadata as md
        return md.version("hermes-station")
    except Exception:
        return None


shim: Shim = Shim()


__all__ = ["shim", "Shim", "CapabilityFlags"]
