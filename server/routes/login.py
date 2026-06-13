"""Login / logout / auth-status routes."""

from __future__ import annotations

import json
import logging

from aiohttp import web

from server.auth import (
    SESSION_COOKIE_NAME,
    auth_status,
    build_clear_cookie_header,
    build_session_cookie_header,
    is_localhost,
)
from server.lib import config_reader
from server.lib.argon2_hash import verify_password
from server.lib.session_store import get_default_store
from server.middleware.rate_limit import _peer_ip

logger = logging.getLogger(__name__)

router = web.RouteTableDef()


@router.get("/api/auth-status")
async def handle_auth_status(request: web.Request) -> web.Response:
    return web.json_response(await auth_status(request))


_LOGIN_BUCKET: dict[str, tuple[int, float]] = {}
_LOGIN_LIMIT = 5
_LOGIN_WINDOW_SECONDS = 30.0
_LOGIN_BUCKET_GC_THRESHOLD = 256


def _login_rate_limited(ip: str) -> bool:
    import time
    now = time.monotonic()
    if len(_LOGIN_BUCKET) >= _LOGIN_BUCKET_GC_THRESHOLD:
        expired = [k for k, (_, reset) in _LOGIN_BUCKET.items() if now > reset]
        for k in expired:
            del _LOGIN_BUCKET[k]
    entry = _LOGIN_BUCKET.get(ip)
    if entry is None or now > entry[1]:
        _LOGIN_BUCKET[ip] = (1, now + _LOGIN_WINDOW_SECONDS)
        return False
    count, reset = entry
    count += 1
    _LOGIN_BUCKET[ip] = (count, reset)
    return count > _LOGIN_LIMIT


@router.post("/api/login")
async def handle_login(request: web.Request) -> web.Response:
    ip = _peer_ip(request)
    if _login_rate_limited(ip):
        return web.json_response({"error": "rate_limit_exceeded"}, status=429)

    password_hash = config_reader.hms_password_hash()
    caller = ip if not is_localhost(request) else "localhost"

    if not password_hash:
        logger.warning("[hms.login] login attempt with no password configured (from %s)", caller)
        return web.json_response({"error": "no_password_configured"}, status=400)

    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)

    pw = body.get("password") if isinstance(body, dict) else None
    if not isinstance(pw, str) or not pw:
        return web.json_response({"error": "missing_password"}, status=400)

    # When a login name is configured it's a required credential: both the
    # username and the password must match. Constant-ish — we still verify the
    # password even on a username miss to avoid a trivial username oracle.
    configured_user = config_reader.hms_user_name()
    submitted_user = body.get("username") if isinstance(body, dict) else None
    pw_ok = verify_password(password_hash, pw)
    user_ok = (not configured_user) or (
        isinstance(submitted_user, str) and submitted_user.strip() == configured_user
    )
    if not (pw_ok and user_ok):
        logger.warning("[hms.login] login failed from %s", caller)
        return web.json_response({"error": "invalid_credentials"}, status=401)

    logger.info("[hms.login] login ok from %s", caller)
    token = await get_default_store().create(
        config_reader.hms_session_ttl_seconds()
    )
    cookie = build_session_cookie_header(request, token)
    return web.json_response({"ok": True}, headers={"Set-Cookie": cookie})


@router.post("/api/logout")
async def handle_logout(request: web.Request) -> web.Response:
    token = request.cookies.get(SESSION_COOKIE_NAME, "")
    if token:
        await get_default_store().invalidate(token)
    return web.json_response({"ok": True}, headers={"Set-Cookie": build_clear_cookie_header()})


def attach(app: web.Application) -> None:
    app.router.add_routes(router)


__all__ = ["attach"]
