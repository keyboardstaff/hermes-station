"""Per-IP rate limiter — only trusts XFF when peer is loopback."""

from __future__ import annotations

import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from aiohttp import web

_LOCALHOST_RE = re.compile(r"^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$")


@dataclass
class _Bucket:
    count: int
    reset_at: float


def _peer_ip(request: web.Request) -> str:
    peer = request.transport.get_extra_info("peername") if request.transport else None
    sock_addr = peer[0] if peer else ""
    sock_is_local = bool(_LOCALHOST_RE.match(sock_addr))
    xff = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    if sock_is_local and xff:
        return xff
    return sock_addr or "unknown"


def rate_limit(*, limit: int = 100, window_seconds: float = 60.0) -> Callable:
    store: dict[str, _Bucket] = {}

    @web.middleware
    async def middleware(
        request: web.Request,
        handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
    ) -> web.StreamResponse:
        ip = _peer_ip(request)
        now = time.monotonic()
        bucket = store.get(ip)
        if bucket is None or now > bucket.reset_at:
            bucket = _Bucket(count=0, reset_at=now + window_seconds)
            store[ip] = bucket
        bucket.count += 1

        if len(store) > 10_000:
            stale = [k for k, v in store.items() if now > v.reset_at]
            for k in stale:
                store.pop(k, None)

        if bucket.count > limit:
            return web.json_response(
                {"error": "rate_limit_exceeded"},
                status=429,
                headers={
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )

        resp = await handler(request)
        remaining = max(0, limit - bucket.count)
        try:
            resp.headers["X-RateLimit-Limit"] = str(limit)
            resp.headers["X-RateLimit-Remaining"] = str(remaining)
        except (AttributeError, TypeError):
            pass
        return resp

    return middleware
