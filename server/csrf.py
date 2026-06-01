"""CSRF middleware — require X-HMS-CSRF on state-mutating verbs.

Header-presence works because cross-origin form POSTs can't set custom headers
without a CORS preflight, which our CORS middleware rejects by default.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from aiohttp import web

PUBLIC_PATHS: frozenset[str] = frozenset({
    "/api/auth-status",
    "/api/login",
})

_STATE_MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@web.middleware
async def csrf_middleware(
    request: web.Request,
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> web.StreamResponse:
    if request.method not in _STATE_MUTATING:
        return await handler(request)
    if request.path in PUBLIC_PATHS:
        return await handler(request)
    if not request.headers.get("X-HMS-CSRF"):
        return web.json_response({"error": "csrf_required"}, status=403)
    return await handler(request)
