"""POST /api/onboarding — first-run setup: login name + optional password.

One atomic call from the setup wizard: persists the login name, an optional
password (argon2-hashed), and flips the `onboarded` flag so the wizard never
shows again. Mutation ⇒ CSRF-gated by middleware; only reachable by a trusted
viewer (no-password localhost, or a logged-in session) since auth_status only
reports `needsOnboarding` to those.
"""

from __future__ import annotations

import json
import logging

from aiohttp import web

from server import settings as settings_mod
from server.lib import argon2_hash, config_reader

logger = logging.getLogger(__name__)
router = web.RouteTableDef()

_MIN_PASSWORD_LEN = 8


@router.post("/api/onboarding")
async def complete_onboarding(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)

    updates: dict[str, object] = {"onboarded": True}

    user_name = body.get("user_name")
    if user_name is not None:
        if not isinstance(user_name, str):
            return web.json_response({"error": "invalid_user_name"}, status=400)
        updates["user_name"] = user_name.strip()

    password = body.get("password")
    if password is not None and password != "":
        if not isinstance(password, str) or len(password.strip()) < _MIN_PASSWORD_LEN:
            return web.json_response(
                {"error": "invalid_password", "detail": f"min length {_MIN_PASSWORD_LEN}"},
                status=400,
            )
        try:
            updates["password_hash"] = argon2_hash.hash_password(password)
        except Exception:
            logger.exception("[hms.onboarding] argon2 hash failed")
            return web.json_response({"error": "internal_error"}, status=500)

    try:
        settings_mod.apply_extra_update(updates)
    except settings_mod.SettingsError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    except Exception:
        logger.exception("[hms.onboarding] config write failed")
        return web.json_response({"error": "internal_error"}, status=500)

    return web.json_response({
        "ok": True,
        "userName": config_reader.hms_user_name(),
        "hasPassword": bool(config_reader.hms_password_hash()),
    })


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
