"""MCP server management — the configured ``mcp_servers`` block.

Surfaces the *config* layer of upstream's MCP support so the Skills page can
list / enable / disable / remove / add server entries. The heavier catalog
git-install + OAuth flow stays in the CLI (`hermes mcp ...`) — see
``docs/CAPABILITY_COVERAGE.md`` (this moves MCP from ✗ to ◐).

Endpoints (all under the active profile's ``config.yaml`` → ``mcp_servers``):
  GET    /api/mcp/servers            → { servers: [{name, transport, command,
                                          args, url, enabled, auth}], path }
  POST   /api/mcp/servers            → add a server (stdio: command[+args] |
                                          http: url[+auth]); 409 if it exists
  PATCH  /api/mcp/servers/{name}     → { enabled: bool } toggle
  DELETE /api/mcp/servers/{name}     → remove the entry

Enable/disable goes through ``yaml_edit`` (comment-preserving scalar write);
add/remove rewrite the ``mcp_servers`` block via a parsed round-trip (server
entries are machine-shaped, not hand-commented).
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Callable

import yaml
from aiohttp import web

from server.lib import config_reader, yaml_edit
from server.lib.profile_run import profile_home_override
from server.lib.route_helpers import profile_arg
from server.lib.upstream_paths import hermes_home
from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

# MCP server names: slug-ish, matches upstream's tolerance.
_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-.]{0,63}$")


def _config_path():
    return hermes_home() / "config.yaml"


async def _write_scoped(profile: str | None, apply: Callable[[], str | None]) -> str | None:
    """Run a config-writing ``apply`` under the viewed profile's ``HERMES_HOME``
    (Phase B — edit any profile), then reload the LIVE config only for the
    active/default home. A named-profile write lands on *that* profile's on-disk
    ``config.yaml`` (applied when it runs); reloading under its override would
    pollute the live process's config with another home's values."""
    with profile_home_override(profile):
        err = await asyncio.to_thread(apply)
    if err is None and profile is None:
        await asyncio.to_thread(config_reader.reload)
    return err


def _read_config_text() -> str:
    try:
        return _config_path().read_text(encoding="utf-8")
    except OSError:
        return ""


def _serialize(name: str, cfg: dict) -> dict:
    """Normalize a raw ``mcp_servers.<name>`` block into a UI-friendly shape."""
    enabled = cfg.get("enabled", True)
    if isinstance(enabled, str):
        enabled = enabled.strip().lower() in {"true", "1", "yes"}
    transport = "http" if cfg.get("url") else "stdio"
    return {
        "name": name,
        "transport": transport,
        "command": cfg.get("command"),
        "args": list(cfg.get("args") or []),
        "url": cfg.get("url"),
        "auth": cfg.get("auth"),
        "enabled": bool(enabled),
    }


@router.get("/api/mcp/servers")
async def list_servers(request: web.Request) -> web.Response:
    profile, err = profile_arg(request)
    if err is not None:
        return err
    fn = shim.mcp.installed_servers
    if fn is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        # ``?profile=`` reads that profile's own ``mcp_servers`` block (its home).
        with profile_home_override(profile):
            servers = await asyncio.to_thread(fn)
            path = str(_config_path())
    except Exception:
        logger.exception("[hms.mcp] installed_servers failed")
        return web.json_response({"error": "list_failed"}, status=500)
    out = [_serialize(name, cfg or {}) for name, cfg in (servers or {}).items()]
    out.sort(key=lambda s: s["name"].lower())
    return web.json_response({"servers": out, "path": path})


@router.post("/api/mcp/servers")
async def add_server(request: web.Request) -> web.Response:
    profile, perr = profile_arg(request)
    if perr is not None:
        return perr
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)

    name = body.get("name")
    if not isinstance(name, str) or not _NAME_RE.match(name):
        return web.json_response({"error": "invalid_name"}, status=400)

    transport = body.get("transport")
    entry: dict = {"enabled": True}
    if transport == "stdio":
        command = body.get("command")
        if not isinstance(command, str) or not command.strip():
            return web.json_response({"error": "command_required"}, status=400)
        entry["command"] = command.strip()
        args = body.get("args") or []
        if args:
            if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
                return web.json_response({"error": "invalid_args"}, status=400)
            entry["args"] = args
    elif transport == "http":
        url = body.get("url")
        if not isinstance(url, str) or not url.strip():
            return web.json_response({"error": "url_required"}, status=400)
        entry["url"] = url.strip()
        if body.get("auth") == "oauth":
            entry["auth"] = "oauth"
    else:
        return web.json_response({"error": "invalid_transport"}, status=400)

    def _apply() -> str | None:
        text = _read_config_text()
        doc = yaml.safe_load(text) or {}
        if not isinstance(doc, dict):
            return "config_not_mapping"
        servers = doc.get("mcp_servers") or {}
        if not isinstance(servers, dict):
            return "mcp_servers_not_mapping"
        if name in servers:
            return "exists"
        servers[name] = entry
        doc["mcp_servers"] = servers
        yaml_edit.write_text_atomic(_config_path(), yaml.safe_dump(doc, sort_keys=False))
        return None

    err = await _write_scoped(profile, _apply)
    if err == "exists":
        return web.json_response({"error": "already_exists"}, status=409)
    if err is not None:
        return web.json_response({"error": err}, status=400)
    return web.json_response({"ok": True, "name": name}, status=201)


@router.patch("/api/mcp/servers/{name}")
async def toggle_server(request: web.Request) -> web.Response:
    profile, perr = profile_arg(request)
    if perr is not None:
        return perr
    name = request.match_info["name"]
    if not _NAME_RE.match(name):
        return web.json_response({"error": "invalid_name"}, status=400)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    enabled = body.get("enabled")
    if not isinstance(enabled, bool):
        return web.json_response({"error": "enabled_required"}, status=400)

    def _apply() -> str | None:
        text = _read_config_text()
        doc = yaml.safe_load(text) or {}
        servers = doc.get("mcp_servers") if isinstance(doc, dict) else None
        if not isinstance(servers, dict) or name not in servers:
            return "not_found"
        # Comment-preserving scalar write at mcp_servers.<name>.enabled.
        new_text = yaml_edit.set_scalar_at_path(text, ("mcp_servers", name, "enabled"), enabled)
        yaml_edit.write_text_atomic(_config_path(), new_text)
        return None

    err = await _write_scoped(profile, _apply)
    if err == "not_found":
        return web.json_response({"error": "not_found"}, status=404)
    if err is not None:
        return web.json_response({"error": err}, status=400)
    return web.json_response({"ok": True, "name": name, "enabled": enabled})


@router.delete("/api/mcp/servers/{name}")
async def remove_server(request: web.Request) -> web.Response:
    profile, perr = profile_arg(request)
    if perr is not None:
        return perr
    name = request.match_info["name"]
    if not _NAME_RE.match(name):
        return web.json_response({"error": "invalid_name"}, status=400)

    def _apply() -> str | None:
        text = _read_config_text()
        doc = yaml.safe_load(text) or {}
        servers = doc.get("mcp_servers") if isinstance(doc, dict) else None
        if not isinstance(servers, dict) or name not in servers:
            return "not_found"
        servers.pop(name, None)
        doc["mcp_servers"] = servers
        yaml_edit.write_text_atomic(_config_path(), yaml.safe_dump(doc, sort_keys=False))
        return None

    err = await _write_scoped(profile, _apply)
    if err == "not_found":
        return web.json_response({"error": "not_found"}, status=404)
    if err is not None:
        return web.json_response({"error": err}, status=400)
    return web.json_response({"ok": True, "name": name})


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
