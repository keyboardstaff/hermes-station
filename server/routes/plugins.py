"""Plugins domain — dynamic discovery + ``platforms.*`` section of config.yaml.

Discovery (platforms / slash / themes registry + WS-push watcher) and
``config_yaml`` (raw YAML read/write proxy with sha256 guard) share the
same plugin domain, so they are implemented in one module.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web

from server.lib.upstream_paths import hermes_home
from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)

router = web.RouteTableDef()


# ── Discovery ────────────────────────────────────────────────────────

DISCOVERY_CHANNEL = "discovery"

_WATCHER_INTERVAL_S = 30.0


def _build_platforms_payload() -> dict:
    items = shim.platforms.list_all()
    return {"platforms": items, "count": len(items)}


def _build_slash_commands_payload() -> dict:
    # Description empty by design — SPA renders from i18n (slash.<name>.description).
    items = shim.slash.list_available()
    return {"commands": items, "count": len(items)}


def _build_themes_payload() -> dict:
    items = shim.themes.list()
    return {"themes": items, "count": len(items)}


_BUILDERS: dict[str, Callable[[], dict]] = {
    "platforms": _build_platforms_payload,
    "slash-commands": _build_slash_commands_payload,
    "themes": _build_themes_payload,
}


@router.get("/api/discover/platforms")
async def get_platforms(request: web.Request) -> web.Response:
    return web.json_response(_build_platforms_payload())


@router.get("/api/discover/slash-commands")
async def get_slash_commands(request: web.Request) -> web.Response:
    return web.json_response(_build_slash_commands_payload())


@router.get("/api/discover/themes")
async def get_themes(request: web.Request) -> web.Response:
    return web.json_response(_build_themes_payload())


def _payload_hash(payload: dict) -> str:
    # sort_keys avoids spurious change events from dict insertion-order differences.
    blob = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(blob).hexdigest()


async def _watcher_loop() -> None:
    """Re-hash each resource ~30s; per-resource try/except so one rename doesn't kill the loop."""
    from server.ws import get_ws_manager

    seen: dict[str, str] = {}
    logger.info("[hms.plugins] watcher started (every %.0fs)", _WATCHER_INTERVAL_S)

    # Seed so the first poll doesn't broadcast "everything changed".
    for name, builder in _BUILDERS.items():
        try:
            seen[name] = _payload_hash(builder())
        except Exception:
            logger.exception("[hms.plugins] %s initial probe failed", name)
            seen[name] = ""

    try:
        while True:
            await asyncio.sleep(_WATCHER_INTERVAL_S)
            ws = get_ws_manager()
            for name, builder in _BUILDERS.items():
                try:
                    digest = _payload_hash(builder())
                except Exception:
                    logger.exception("[hms.plugins] %s probe failed", name)
                    continue
                if digest != seen.get(name):
                    seen[name] = digest
                    try:
                        await ws.broadcast(DISCOVERY_CHANNEL, {
                            "type": "discovery.changed",
                            "resource": name,
                            "timestamp": time.time(),
                        })
                        logger.info("[hms.plugins] %s changed → broadcast", name)
                    except Exception:
                        logger.exception("[hms.plugins] WS broadcast failed for %s", name)
    except asyncio.CancelledError:
        logger.info("[hms.plugins] watcher cancelled")
        raise


# ── config.yaml raw read/write (proxies to upstream Dashboard) ───────


def _read_yaml(path: Path) -> tuple[str, float]:
    if not path.is_file():
        return "", 0.0
    return path.read_text(encoding="utf-8"), path.stat().st_mtime


CONFIG_FILENAME = "config.yaml"


def _config_path() -> Path:
    return hermes_home() / CONFIG_FILENAME


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


@router.get("/api/config/yaml")
async def get_config_yaml(request: web.Request) -> web.Response:
    path = _config_path()
    try:
        text, mtime = await asyncio.to_thread(_read_yaml, path)
    except OSError:
        logger.exception("[hms.plugins] read failed: %s", path)
        return web.json_response({"error": "read_failed"}, status=500)
    return web.json_response({
        "yaml": text,
        "sha256": _sha256(text),
        "mtime": mtime,
        "path": str(path),
    })


@router.put("/api/config/yaml")
async def put_config_yaml(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)

    yaml_text = body.get("yaml_text")
    expected = body.get("expected_sha256")
    if not isinstance(yaml_text, str):
        return web.json_response({"error": "yaml_text_required"}, status=400)
    if not isinstance(expected, str) or not expected:
        return web.json_response({"error": "expected_sha256_required"}, status=400)

    path = _config_path()
    current, _mtime = await asyncio.to_thread(_read_yaml, path)
    current_sha = _sha256(current)
    if current_sha != expected:
        return web.json_response({
            "conflict": True,
            "current_sha256": current_sha,
            "error": "concurrent_edit",
        }, status=409)

    # Forward to upstream: it validates YAML, preserves comments, normalises ordering.
    from server.lib import config_reader
    dash_url = config_reader.dashboard_url().rstrip("/")
    target = f"{dash_url}/api/config/raw"

    try:
        timeout = aiohttp.ClientTimeout(total=15.0)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.put(
                target,
                json={"yaml_text": yaml_text},
                headers=_dashboard_auth_headers(),
            ) as resp:
                payload: Any
                try:
                    payload = await resp.json()
                except Exception:
                    payload = {"raw": await resp.text()}
                if 200 <= resp.status < 300:
                    config_reader.reload()
                return web.json_response(payload, status=resp.status)
    except (aiohttp.ClientError, OSError) as exc:
        logger.warning("[hms.plugins] upstream PUT failed: %s", exc)
        return web.json_response({
            "error": "upstream_unreachable",
            "hint": "Start the Dashboard or check Settings → Connection.",
        }, status=503)


def _dashboard_auth_headers() -> dict[str, str]:
    from server.lib import config_reader
    token = config_reader.dashboard_token()
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


@router.put("/api/plugins/runtime-providers")
async def put_runtime_providers(request: web.Request) -> web.Response:
    """Persist memory.provider + context.engine to the active profile config.

    Powers the Plugins page "Runtime provider plugins" module. Takes effect
    next session (the gateway reads these at startup). Empty memory provider
    means built-in.
    """
    from server.lib import yaml_edit
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)
    memory_provider = body.get("memory_provider")
    context_engine = body.get("context_engine")
    if memory_provider is not None and not isinstance(memory_provider, str):
        return web.json_response({"error": "invalid_memory_provider"}, status=400)
    if context_engine is not None and not isinstance(context_engine, str):
        return web.json_response({"error": "invalid_context_engine"}, status=400)

    path = _config_path()
    try:
        text = await asyncio.to_thread(
            lambda: path.read_text(encoding="utf-8") if path.is_file() else ""
        )
        if memory_provider is not None:
            text = yaml_edit.set_scalar_at_path(text, ["memory", "provider"], memory_provider)
        if context_engine is not None:
            text = yaml_edit.set_scalar_at_path(text, ["context", "engine"], context_engine)
        await asyncio.to_thread(yaml_edit.write_text_atomic, path, text)
    except Exception:
        logger.exception("[hms.plugins] runtime-providers write failed")
        return web.json_response({"error": "write_failed"}, status=500)
    return web.json_response({"ok": True})


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach", "_watcher_loop", "DISCOVERY_CHANNEL", "_BUILDERS"]
