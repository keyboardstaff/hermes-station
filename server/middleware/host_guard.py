"""Host header validation — DNS rebinding defense."""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable

from aiohttp import web

from server.lib import config_reader

_LOOPBACK_NAMES = frozenset({"localhost", "127.0.0.1", "[::1]", "::1"})


def _split_host_port(host: str) -> tuple[str, str]:
    if host.startswith("["):
        close = host.find("]")
        if close < 0:
            return host, ""
        return host[: close + 1], host[close + 1 :].lstrip(":")
    if ":" in host:
        name, _, port = host.rpartition(":")
        return name, port
    return host, ""


def _is_loopback_host(host: str) -> bool:
    name, _ = _split_host_port(host)
    return name in _LOOPBACK_NAMES


def _explicit_allowlist() -> frozenset[str] | None:
    raw = os.getenv("HMS_ALLOWED_HOSTS")
    if not raw:
        return None
    items = {s.strip().lower() for s in raw.split(",") if s.strip()}
    return frozenset(items) if items else None


@web.middleware
async def host_guard_middleware(
    request: web.Request,
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> web.StreamResponse:
    host = (request.headers.get("Host") or "").lower()
    if not host:
        return web.json_response({"error": "host_required"}, status=403)

    if _is_loopback_host(host):
        return await handler(request)

    allowlist = _explicit_allowlist()
    if allowlist is not None:
        if host in allowlist:
            return await handler(request)
        return web.json_response({"error": "host_not_allowed", "host": host}, status=403)

    cfg_host = config_reader.hms_host()
    cfg_port = str(config_reader.hms_port())

    if cfg_host == "0.0.0.0":  # noqa: S104
        _, port = _split_host_port(host)
        if port == cfg_port:
            return await handler(request)
        return web.json_response({"error": "host_port_mismatch", "host": host}, status=403)

    if host in (cfg_host, f"{cfg_host}:{cfg_port}"):
        return await handler(request)
    return web.json_response({"error": "host_not_allowed", "host": host}, status=403)
