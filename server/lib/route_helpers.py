"""Tiny shared validators / coercers used across route modules."""

from __future__ import annotations

import re

from aiohttp import web

SESSION_ID_RE = re.compile(r"^[\w\-:.]{1,128}$")
PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def coerce_int_arg(value: str | None, default: int, *, lo: int, hi: int) -> int:
    if value is None or value == "":
        return default
    try:
        v = int(value)
    except ValueError:
        return default
    return max(lo, min(hi, v))


def profile_arg(request: web.Request) -> tuple[str | None, web.Response | None]:
    """Validate a ``?profile=`` view-scope param shared across profile-scoped
    read routes (skills / models / cron / mcp / …).

    Returns ``(name, None)`` for a well-formed named profile, ``(None, None)``
    for an absent / empty / ``default`` scope (read the process home unchanged),
    or ``(None, 400)`` for a malformed name. A well-formed but *unknown* name is
    passed through — ``profile_home_override`` no-ops it back to the process home
    (matching the chat routes' ``_session_db`` fallback) rather than 404ing.
    """
    raw = request.query.get("profile")
    if not raw or raw == "default":
        return None, None
    if not PROFILE_ID_RE.match(raw):
        return None, web.json_response({"error": "invalid_profile"}, status=400)
    return raw, None


__all__ = ["SESSION_ID_RE", "PROFILE_ID_RE", "coerce_int_arg", "profile_arg"]
