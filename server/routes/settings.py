"""Settings REST routes — GET/PATCH/PUT /api/settings."""

from __future__ import annotations

import json
import logging

from aiohttp import web

from server import settings as settings_mod

logger = logging.getLogger(__name__)

router = web.RouteTableDef()


@router.get("/api/settings")
async def get_settings(request: web.Request) -> web.Response:
    try:
        extra = settings_mod.read_extra()
    except Exception:
        logger.exception("[hms.settings] read failed")
        return web.json_response({"error": "internal_error"}, status=500)
    # Strip password_hash; surface boolean password_set for "Set" vs "Change" UI.
    payload = {k: v for k, v in extra.items() if k != "password_hash"}
    payload["password_set"] = bool(str(extra.get("password_hash") or "").strip())
    return web.json_response(payload)


async def _patch_impl(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)

    # password_hash is exclusively managed via /api/password.
    if "password_hash" in body:
        return web.json_response(
            {"error": "use_password_endpoint", "detail": "POST /api/password to rotate"},
            status=400,
        )

    try:
        written = settings_mod.apply_extra_update(body)
    except settings_mod.SettingsError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    except Exception:
        logger.exception("[hms.settings] update failed")
        return web.json_response({"error": "internal_error"}, status=500)

    return web.json_response({"ok": True, "written": written})


@router.patch("/api/settings")
async def patch_settings(request: web.Request) -> web.Response:
    return await _patch_impl(request)


@router.put("/api/settings")
async def put_settings(request: web.Request) -> web.Response:
    return await _patch_impl(request)


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
