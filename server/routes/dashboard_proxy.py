"""Transparent proxy: /api/dashboard/* → {dashboard_url}/api/*; scrapes session token on 401."""

from __future__ import annotations

import asyncio
import logging
import re

from aiohttp import ClientSession, ClientTimeout, web

from server.lib import config_reader

logger = logging.getLogger(__name__)

_PROXY_TIMEOUT = ClientTimeout(total=15.0)
_TOKEN_FETCH_TIMEOUT = ClientTimeout(total=5.0)
_BLOCKED_SUFFIXES = frozenset({"/pty"})

# Upstream FastAPI keeps /dashboard in the path for these — don't strip it.
_UPSTREAM_DASHBOARD_PREFIXES = frozenset({
    "/plugins",
    "/agent-plugins",
    "/themes",
    "/theme",
    "/plugin-providers",
})

_PASSTHROUGH_REQ_HEADERS = frozenset({
    "accept", "accept-encoding", "accept-language",
    "content-type",
})

# Upstream injects <script>window.__HERMES_SESSION_TOKEN__="...";</script> into index.html.
_TOKEN_RE = re.compile(
    r"""window\.__HERMES_SESSION_TOKEN__\s*=\s*["']([^"']+)["']"""
)


_TOKEN_CACHE: dict[str, str] = {}
# Serialise concurrent scrapes — first request kicks off the GET, others await.
_TOKEN_LOCKS: dict[str, asyncio.Lock] = {}


def _lock_for(base: str) -> asyncio.Lock:
    lock = _TOKEN_LOCKS.get(base)
    if lock is None:
        lock = asyncio.Lock()
        _TOKEN_LOCKS[base] = lock
    return lock


async def _fetch_upstream_token(base: str) -> str:
    """Scrape window.__HERMES_SESSION_TOKEN__ from /; returns "" on miss so 401 surfaces."""
    cached = _TOKEN_CACHE.get(base)
    if cached:
        return cached
    lock = _lock_for(base)
    async with lock:
        cached = _TOKEN_CACHE.get(base)
        if cached:
            return cached
        try:
            async with ClientSession(timeout=_TOKEN_FETCH_TIMEOUT) as cs:
                async with cs.get(f"{base}/") as resp:
                    if resp.status >= 400:
                        logger.warning(
                            "[hms.dashboard_proxy] token scrape: GET / → %d",
                            resp.status,
                        )
                        return ""
                    body = await resp.text()
        except Exception as exc:
            logger.warning(
                "[hms.dashboard_proxy] token scrape failed: %s", exc,
            )
            return ""
        m = _TOKEN_RE.search(body)
        if not m:
            logger.warning(
                "[hms.dashboard_proxy] token regex did not match upstream index",
            )
            return ""
        token = m.group(1)
        _TOKEN_CACHE[base] = token
        return token


def _invalidate_token(base: str) -> None:
    _TOKEN_CACHE.pop(base, None)


async def _resolve_token(base: str) -> str:
    """Config-provided override > scraped token."""
    override = config_reader.dashboard_token()
    if override:
        return override
    return await _fetch_upstream_token(base)


async def _do_request(
    method: str,
    upstream_url: str,
    headers: dict[str, str],
    body: bytes | None,
    cs: ClientSession,
):
    return cs.request(
        method=method,
        url=upstream_url,
        headers=headers,
        data=body,
        allow_redirects=False,
    )


async def _proxy(request: web.Request) -> web.StreamResponse:
    suffix = request.path[len("/api/dashboard"):] or "/"
    if suffix in _BLOCKED_SUFFIXES:
        return web.json_response({"error": "not_available"}, status=403)

    base = config_reader.dashboard_url().rstrip("/")
    _needs_dashboard = any(
        suffix == p or suffix.startswith(p + "/")
        for p in _UPSTREAM_DASHBOARD_PREFIXES
    )
    upstream_path = f"/api/dashboard{suffix}" if _needs_dashboard else f"/api{suffix}"
    upstream_url = f"{base}{upstream_path}"
    if request.query_string:
        upstream_url = f"{upstream_url}?{request.query_string}"

    # Drop Cookie/Authorization — those are station-scoped, meaningless upstream.
    fwd_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() in _PASSTHROUGH_REQ_HEADERS
    }

    body: bytes | None = None
    if request.method not in ("GET", "HEAD"):
        body = await request.read()

    # 2 attempts: on 401 invalidate token and retry once (covers upstream restarts).
    for attempt in range(2):
        token = await _resolve_token(base)
        if token:
            fwd_headers["X-Hermes-Session-Token"] = token
        elif "X-Hermes-Session-Token" in fwd_headers:
            del fwd_headers["X-Hermes-Session-Token"]

        try:
            cs = ClientSession(timeout=_PROXY_TIMEOUT)
        except Exception:
            logger.exception("[hms.dashboard_proxy] failed to open client session")
            return web.json_response(
                {"error": "dashboard_unavailable", "available": False},
                status=503,
            )

        try:
            async with cs:
                async with await _do_request(
                    request.method, upstream_url, fwd_headers, body, cs,
                ) as up:
                    if up.status == 401 and attempt == 0:
                        _invalidate_token(base)
                        continue
                    # Stream back so SSE works.
                    resp = web.StreamResponse(
                        status=up.status,
                        reason=up.reason,
                        headers={
                            "Content-Type": up.headers.get(
                                "Content-Type", "application/octet-stream"
                            ),
                            **({"Cache-Control": up.headers["Cache-Control"]}
                               if "Cache-Control" in up.headers else {}),
                        },
                    )
                    await resp.prepare(request)
                    async for chunk in up.content.iter_chunked(64 * 1024):
                        await resp.write(chunk)
                    await resp.write_eof()
                    return resp
        except Exception:
            logger.warning(
                "[hms.dashboard_proxy] upstream unreachable for %s", upstream_url,
            )
            return web.json_response(
                {"error": "dashboard_unavailable", "available": False},
                status=503,
            )

    return web.json_response(
        {"error": "dashboard_unavailable", "available": False},
        status=503,
    )


def attach(app: web.Application) -> None:
    app.router.add_route("*", "/api/dashboard/{tail:.*}", _proxy)


def reset_for_test() -> None:
    _TOKEN_CACHE.clear()
    _TOKEN_LOCKS.clear()


__all__ = ["attach", "reset_for_test"]
