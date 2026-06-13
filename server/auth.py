"""Auth — cookie session token + argon2 password + localhost trust."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import TypedDict

from aiohttp import web

from server.lib import config_reader
from server.lib.session_store import get_default_store

_LOCALHOST_RE = re.compile(r"^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$")

SESSION_COOKIE_NAME = "hms_session"

_PUBLIC_PATHS: frozenset[str] = frozenset({
    "/api/auth-status",
    "/api/login",
})


def _socket_addr(request: web.Request) -> str:
    if request.transport is None:
        return ""
    peer = request.transport.get_extra_info("peername")
    return peer[0] if peer else ""


def _is_unix_socket(request: web.Request) -> bool:
    """An AF_UNIX connection is necessarily local (no remote peer can reach a
    Unix socket), so it counts as a loopback base — this is how the dev Vite
    proxy reaches the backend when it binds a socket instead of a TCP port."""
    transport = request.transport
    if transport is None:
        return False
    sock = transport.get_extra_info("socket")
    try:
        import socket as _socket
        return sock is not None and sock.family == _socket.AF_UNIX
    except Exception:
        return False


def is_localhost(request: web.Request) -> bool:
    """True iff the connection is loopback-based.

    The base is loopback when the socket peer is 127.x / ::1 (TCP) or the
    transport is an AF_UNIX socket (the dev Vite proxy). From a loopback base we
    still honor X-Forwarded-For so a LAN client tunnelled through the proxy is
    treated as remote.
    """
    sock = _socket_addr(request)
    if not _LOCALHOST_RE.match(sock) and not _is_unix_socket(request):
        return False
    xff = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    if xff:
        return bool(_LOCALHOST_RE.match(xff))
    return True


def _cookie_token(request: web.Request) -> str:
    return request.cookies.get(SESSION_COOKIE_NAME, "")


class AuthStatus(TypedDict):
    requiresLogin: bool
    loggedIn: bool
    localhost: bool
    needsOnboarding: bool
    userName: str


async def auth_status(request: web.Request) -> AuthStatus:
    local = is_localhost(request)
    has_password = bool(config_reader.hms_password_hash())
    # First-run wizard: only ever shown to a trusted (no-login) viewer, so a
    # locked-out LAN client never sees it.
    needs_onboarding = not config_reader.hms_onboarded()
    user_name = config_reader.hms_user_name()
    if not has_password or local:
        return {
            "requiresLogin": False, "loggedIn": True, "localhost": local,
            "needsOnboarding": needs_onboarding, "userName": user_name,
        }
    token = _cookie_token(request)
    is_valid = bool(token) and await get_default_store().is_valid(token)
    return {
        "requiresLogin": True, "loggedIn": is_valid, "localhost": local,
        # Onboarding requires a trusted session; gate it on being logged in.
        "needsOnboarding": needs_onboarding and is_valid, "userName": user_name,
    }


def build_session_cookie_header(request: web.Request, token: str) -> str:
    ttl = config_reader.hms_session_ttl_seconds()
    proto = (request.headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower()
    parts = [
        f"{SESSION_COOKIE_NAME}={token}",
        "HttpOnly",
        "SameSite=Strict",
        f"Max-Age={ttl}",
        "Path=/",
    ]
    if proto == "https":
        parts.append("Secure")
    return "; ".join(parts)


def build_clear_cookie_header() -> str:
    return f"{SESSION_COOKIE_NAME}=; HttpOnly; Max-Age=0; Path=/"


@web.middleware
async def auth_middleware(
    request: web.Request,
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> web.StreamResponse:
    if not request.path.startswith("/api/") and not request.path.startswith("/ws"):
        return await handler(request)
    if request.path in _PUBLIC_PATHS:
        return await handler(request)
    if not config_reader.hms_password_hash() or is_localhost(request):
        return await handler(request)
    token = _cookie_token(request)
    if token and await get_default_store().is_valid(token):
        return await handler(request)
    return web.json_response({"error": "unauthorized"}, status=401)
