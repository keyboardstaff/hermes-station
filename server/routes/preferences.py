"""Station preference REST endpoints — owner-level settings that sync across
browsers/devices (server is the source of truth). Currently: pinned sessions.

CSRF is enforced globally (``csrf_middleware``); auth is the shared middleware.
"""

from __future__ import annotations

import logging

from aiohttp import web

from server.lib import station_prefs

logger = logging.getLogger(__name__)

router = web.RouteTableDef()


@router.get("/api/preferences/pinned")
async def get_pinned(_request: web.Request) -> web.Response:
    return web.json_response({"pinned": station_prefs.get_pinned()})


@router.put("/api/preferences/pinned")
async def put_pinned(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except (ValueError, web.HTTPException):
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict) or not isinstance(body.get("pinned"), list):
        return web.json_response({"error": "pinned_must_be_list"}, status=400)
    try:
        stored = station_prefs.set_pinned(body["pinned"])
    except OSError:
        logger.warning("[hms.preferences] failed to persist pinned set", exc_info=True)
        return web.json_response({"error": "write_failed"}, status=500)
    return web.json_response({"pinned": stored})


def attach(app: web.Application) -> None:
    app.router.add_routes(router)
