"""Skills content endpoint — returns raw SKILL.md text for a given skill name.

GET /api/dashboard/skills/{name}/content
  → 200  { content: str, exists: true }
  → 200  { content: "", exists: false }   (no SKILL.md found)
  → 404  JSON error  (agent not importable)
  → 400  JSON error  (invalid skill name)

Search order (first match wins):
  1. {agent_root}/skills/**/{name}/SKILL.md   (category sub-dirs)
  2. {agent_root}/plugins/{name}/SKILL.md     (plugin-bundled skills)
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from aiohttp import web

from server.lib.profile_run import profile_home_override
from server.lib.route_helpers import profile_arg
from server.lib.upstream_shim import _agent_root, shim

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

# Only allow names that look like valid identifiers (slug format).
_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,63}$", re.IGNORECASE)

_MAX_BYTES = 512 * 1024  # 512 KiB cap — SKILL.md should never be huge


def _find_skill_md(name: str) -> Path | None:
    root = _agent_root()
    if root is None:
        return None

    # 1. skills/{category}/{name}/SKILL.md  (glob one level deep)
    for candidate in (root / "skills").glob(f"*/{name}/SKILL.md"):
        if candidate.is_file():
            return candidate

    # 2. Direct: skills/{name}/SKILL.md
    direct = root / "skills" / name / "SKILL.md"
    if direct.is_file():
        return direct

    # 3. plugins/{name}/SKILL.md
    plugin_path = root / "plugins" / name / "SKILL.md"
    if plugin_path.is_file():
        return plugin_path

    return None


def _map_lock_source(src: str | None) -> str:
    """Normalize a HubLockFile provenance to the UI source vocabulary."""
    s = (src or "").lower()
    if s in ("github", "git"):
        return "git"
    if s in ("huggingface", "hf"):
        return "hf"
    if s == "official":
        return "hub"
    return "community"


def _hub_sources() -> dict[str, str]:
    """name → normalized source for skills installed via the hub lock file."""
    HubLockFile = shim.skills.hub_lock_file
    if HubLockFile is None:
        return {}
    try:
        installed = HubLockFile().load().get("installed", {})
    except Exception:
        return {}
    return {
        name: _map_lock_source(entry.get("source"))
        for name, entry in installed.items()
        if isinstance(entry, dict)
    }


def _classify_source(name: str, hub: dict[str, str]) -> str:
    """hub-installed (lock) → its provenance; in the agent's bundled set →
    'bundled'; otherwise dropped into the profile by the user → 'user'."""
    if name in hub:
        return hub[name]
    if _find_skill_md(name) is not None:
        return "bundled"
    return "user"


@router.get("/api/skills")
async def list_skills(request: web.Request) -> web.Response:
    """Station-native skills list with correct provenance.

    Mirrors upstream ``/api/skills`` (``_find_all_skills`` + disabled set) and
    enriches each row with a ``source`` derived in-process — the dashboard
    plugin-hub merge keyed on platform-plugin names, which never matched skill
    names (every row showed ``unknown``).

    ``?profile=<name>`` reads that profile's own skills (its ``HERMES_HOME``)
    via the in-process home override — the read-only view scope; omitted/default
    reads the process home unchanged."""
    if not shim.flags.agent_importable:
        return web.json_response({"error": "Agent not importable on this host."}, status=404)
    profile, err = profile_arg(request)
    if err is not None:
        return err
    find_all = shim.skills.find_all
    get_disabled = shim.skills.get_disabled
    load_config = shim.skills.load_config
    if find_all is None or get_disabled is None or load_config is None:
        return web.json_response({"error": "skills_unavailable"}, status=503)

    try:
        # find_all / load_config / _classify_source all resolve paths from the
        # active HERMES_HOME, so scope the whole read (incl. provenance) under it.
        with profile_home_override(profile):
            disabled = get_disabled(load_config())
            raw = find_all(skip_disabled=True) or []
            hub = _hub_sources()
            skills = [
                {
                    "name": s.get("name", ""),
                    "description": s.get("description", ""),
                    "category": s.get("category"),
                    "enabled": s.get("name") not in disabled,
                    "source": _classify_source(s.get("name", ""), hub),
                }
                for s in raw
                if s.get("name")
            ]
    except Exception:
        logger.exception("[hms.skills] list failed")
        return web.json_response({"error": "list_failed"}, status=500)

    return web.json_response({"skills": skills})


@router.get("/api/toolsets")
async def list_toolsets(request: web.Request) -> web.Response:
    """Configurable toolsets with enabled/configured state + their tools.

    Mirrors upstream ``/api/tools/toolsets`` via the shim — powers the Skills
    page's Toolsets view. ``?profile=`` scopes the read to that profile's home."""
    if not shim.flags.agent_importable:
        return web.json_response({"error": "Agent not importable on this host."}, status=404)
    profile, err = profile_arg(request)
    if err is not None:
        return err
    ts = shim.toolsets
    if ts.list_configurable is None or ts.get_platform_tools is None or ts.load_config is None:
        return web.json_response({"error": "toolsets_unavailable"}, status=503)
    try:
        with profile_home_override(profile):
            config = ts.load_config()
            enabled = set(
                ts.get_platform_tools(config, "cli", include_default_mcp_servers=False) or []
            )
            out = []
            for name, label, desc in ts.list_configurable():
                try:
                    tools = sorted(set(ts.resolve(name))) if ts.resolve else []
                except Exception:
                    tools = []
                is_enabled = name in enabled
                out.append({
                    "name": name,
                    "label": label,
                    "description": desc,
                    "enabled": is_enabled,
                    "configured": bool(ts.has_keys(name, config)) if ts.has_keys else False,
                    "tools": tools,
                })
    except Exception:
        logger.exception("[hms.toolsets] list failed")
        return web.json_response({"error": "list_failed"}, status=500)
    return web.json_response({"toolsets": out})


@router.get("/api/dashboard/skills/{name}/content")
async def get_skill_content(request: web.Request) -> web.Response:
    if not shim.flags.agent_importable:
        return web.json_response(
            {"error": "Agent not importable on this host."},
            status=404,
        )

    name = request.match_info["name"]
    if not _NAME_RE.fullmatch(name):
        return web.json_response({"error": "Invalid skill name."}, status=400)

    path = _find_skill_md(name)
    if path is None:
        return web.json_response({"content": "", "exists": False})

    try:
        data = path.read_bytes()
        text = data[:_MAX_BYTES].decode("utf-8", errors="replace")
    except OSError as exc:
        logger.warning("skills_content: could not read %s: %s", path, exc)
        return web.json_response({"content": "", "exists": False})

    return web.json_response({"content": text, "exists": True})


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
