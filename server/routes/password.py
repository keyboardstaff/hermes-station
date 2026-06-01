"""POST /api/password — rotate the station password; invalidates all sessions on success."""

from __future__ import annotations

import json
import logging

from aiohttp import web

from server import settings as settings_mod
from server.lib import argon2_hash, config_reader
from server.lib.session_store import get_default_store

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

_MIN_PASSWORD_LEN = 6


@router.post("/api/password")
async def set_password(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)

    new_pw = body.get("new")
    if not isinstance(new_pw, str) or len(new_pw.strip()) < _MIN_PASSWORD_LEN:
        return web.json_response(
            {"error": "invalid_value:new", "detail": f"min length {_MIN_PASSWORD_LEN}"},
            status=400,
        )

    existing_hash = config_reader.hms_password_hash()
    if existing_hash:
        current = body.get("current")
        if not isinstance(current, str) or not current:
            return web.json_response({"error": "current_required"}, status=400)
        if not argon2_hash.verify_password(existing_hash, current):
            return web.json_response({"error": "wrong_current"}, status=403)

    try:
        new_hash = argon2_hash.hash_password(new_pw)
    except Exception:
        logger.exception("[hms.password] argon2 hash failed")
        return web.json_response({"error": "internal_error"}, status=500)

    # Bypass /api/settings policy that refuses password_hash; LAN-without-password
    # guard inside apply_extra_update still applies (we're setting, not clearing).
    try:
        settings_mod.apply_extra_update({"password_hash": new_hash})
    except settings_mod.SettingsError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    except Exception:
        logger.exception("[hms.password] yaml write failed")
        return web.json_response({"error": "internal_error"}, status=500)

    # Force re-login for everyone, including the current cookie.
    invalidated = await get_default_store().invalidate_all()

    return web.json_response({"ok": True, "sessions_invalidated": invalidated})


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
