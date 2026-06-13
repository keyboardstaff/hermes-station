"""Lifecycle REST endpoints — status snapshot + gateway restart/start/stop.

Install/uninstall remain CLI-managed via `hms`.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time

from aiohttp import web

from server import lifecycle
from server.lib.route_helpers import PROFILE_ID_RE
from server.ws import get_ws_manager

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

LIFECYCLE_CHANNEL = "lifecycle"


async def _broadcast_state(action: str, result: dict) -> None:
    try:
        await get_ws_manager().broadcast(LIFECYCLE_CHANNEL, {
            "type": "lifecycle.changed",
            "action": action,
            "result": result,
            "timestamp": time.time(),
        })
    except Exception:
        logger.exception("[hms.lifecycle] WS broadcast failed")


def _dashboard_snapshot(request: web.Request) -> dict:
    from server.app_keys import DASHBOARD_SUPERVISOR_KEY
    supervisor = request.app.get(DASHBOARD_SUPERVISOR_KEY)
    if supervisor is None:
        from server.lib import config_reader
        return {
            "state": "unmanaged",
            "pid": None,
            "managed_by_hms": False,
            "url": config_reader.dashboard_url(),
            "started_at": None,
            "last_error": None,
            "recent_crashes": [],
        }
    return supervisor.snapshot()


def _snapshot_payload(request: web.Request) -> dict:
    plugin = lifecycle.get_plugin_status()
    gateway = lifecycle.get_gateway_status()
    return {
        "plugin": {
            "repo": str(plugin.plugin_dir),
            "install_dir": str(plugin.plugin_link_dir),
            "files_installed": plugin.files_installed,
            "config_enabled": plugin.config_enabled,
            "config_present": plugin.config_present,
        },
        "dashboard": _dashboard_snapshot(request),
        "gateway": gateway,
        "platform": lifecycle.platform_label(),
    }


@router.get("/api/lifecycle/status")
async def get_status(request: web.Request) -> web.Response:
    try:
        return web.json_response(_snapshot_payload(request))
    except Exception:
        logger.exception("[hms.lifecycle] status failed")
        return web.json_response({"error": "internal_error"}, status=500)


async def _gateway_restart_with_fallback() -> dict:
    """SIGUSR1 first (preserves in-memory state); fall back to spawn when ancestry gates reject."""
    out = lifecycle.request_gateway_self_restart()
    if out.get("ok"):
        return {**out, "method": "sigusr1"}
    fallback_reasons = {"not_running", "not_ancestor"}
    if out.get("reason") in fallback_reasons:
        try:
            spawn = lifecycle.spawn_hermes_gateway_restart()
        except Exception as exc:
            logger.exception("[hms.lifecycle] spawn gateway restart failed")
            return {"ok": False, "reason": "spawn_failed",
                    "error": str(exc), "method": "spawn"}
        return {**spawn, "method": "spawn"}
    return {**out, "method": "sigusr1"}


@router.post("/api/lifecycle/gateway/restart")
async def post_gateway_restart(request: web.Request) -> web.Response:
    try:
        out = await _gateway_restart_with_fallback()
    except Exception:
        logger.exception("[hms.lifecycle] gateway restart failed")
        return web.json_response(
            {"ok": False, "reason": "internal_error",
             "error": "see station logs"},
            status=500,
        )
    # 202 kicked off, 409 user-fixable in-app, 500 hard subprocess failure.
    if out.get("ok"):
        status = 202
    elif out.get("reason") in {"not_installed"}:
        status = 409
    elif out.get("reason") in {"spawn_failed"}:
        status = 500
    else:
        status = 409
    await _broadcast_state("gateway.restart", out)
    return web.json_response(out, status=status)


async def _post_profile_gateway(request: web.Request, action: str) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "reason": "invalid_json"}, status=400)
    profile = body.get("profile")
    if not isinstance(profile, str) or not PROFILE_ID_RE.match(profile):
        return web.json_response({"ok": False, "reason": "invalid_profile"}, status=400)
    try:
        out = await asyncio.to_thread(lifecycle.spawn_profile_gateway, profile, action)
    except Exception:
        logger.exception("[hms.lifecycle] gateway %s for %r failed", action, profile)
        return web.json_response({"ok": False, "reason": "internal_error"}, status=500)
    status = 202 if out.get("ok") else 500
    await _broadcast_state(f"gateway.{action}", out)
    return web.json_response(out, status=status)


@router.post("/api/lifecycle/gateway/start")
async def post_gateway_start(request: web.Request) -> web.Response:
    return await _post_profile_gateway(request, "start")


@router.post("/api/lifecycle/gateway/stop")
async def post_gateway_stop(request: web.Request) -> web.Response:
    return await _post_profile_gateway(request, "stop")


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach", "LIFECYCLE_CHANNEL"]
