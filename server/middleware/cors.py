"""CORS middleware — same-origin always; dev mode allows Vite localhost."""

from __future__ import annotations

import os
import re
from collections.abc import Awaitable, Callable

from aiohttp import web

from server.lib import config_reader

_LOCALHOST_ORIGIN_RE = re.compile(
    r"^https?://(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$"
)


def _is_dev() -> bool:
    return os.getenv("HMS_ENV", "").lower() == "dev"


def _allowed(origin: str) -> bool:
    if not origin:
        return True
    if origin in config_reader.hms_cors_origins():
        return True
    if _is_dev() and _LOCALHOST_ORIGIN_RE.match(origin):
        return True
    return False


@web.middleware
async def cors_middleware(
    request: web.Request,
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> web.StreamResponse:
    origin = request.headers.get("Origin", "")
    is_preflight = request.method == "OPTIONS"

    if is_preflight:
        if not _allowed(origin):
            return web.Response(status=403)
        resp = web.Response(status=204)
    else:
        resp = await handler(request)

    if origin and _allowed(origin):
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Credentials"] = "true"
        resp.headers["Access-Control-Allow-Methods"] = (
            "GET,POST,PUT,PATCH,DELETE,OPTIONS"
        )
        resp.headers["Access-Control-Allow-Headers"] = (
            "Content-Type,X-HMS-CSRF,Authorization"
        )
        resp.headers.setdefault("Vary", "Origin")
    return resp
