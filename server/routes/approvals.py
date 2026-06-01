"""POST /api/approvals/resolve — REST fallback for the WebSocket approval channel."""

from __future__ import annotations

import json
import logging
import re

from aiohttp import web

from server.approvals import VALID_CHOICES, get_bridge
from server.ws import WSConnection
from server.ws_dispatch import register

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

_SESSION_KEY_RE = re.compile(r"^[\w\-:.]{1,128}$")


@register("approval.resolve")
async def _ws_approval_resolve(conn: WSConnection, payload: dict) -> None:
    """WS-side approval resolution. Mirror of REST `/api/approvals/resolve`
    with a session_key OR run_id fallback (run_id lookups the live
    registry to find its session). Always acks back to the caller so
    the SPA can clear its pending state even on validation failures.
    """
    from server import runs

    choice = payload.get("choice")
    session_key = payload.get("session_key") or payload.get("session_id")
    run_id = payload.get("run_id")

    if isinstance(choice, str) and choice not in VALID_CHOICES:
        await conn.enqueue({
            "type": "approval.ack", "ok": False,
            "error": "invalid_choice", "run_id": run_id,
        })
        return

    if not session_key and isinstance(run_id, str) and run_id:
        handle = await runs.get_registry().get(run_id)
        if handle is not None:
            session_key = handle.session_id

    if not isinstance(session_key, str) or not session_key:
        await conn.enqueue({
            "type": "approval.ack", "ok": False,
            "error": "no_session_key", "run_id": run_id,
        })
        return
    if not isinstance(choice, str):
        await conn.enqueue({
            "type": "approval.ack", "ok": False,
            "error": "no_choice", "run_id": run_id,
        })
        return

    try:
        resolved = get_bridge().resolve(session_key, choice)
    except ValueError as exc:
        await conn.enqueue({
            "type": "approval.ack", "ok": False,
            "error": str(exc), "run_id": run_id,
        })
        return
    except Exception:
        logger.exception("[hms.ws] approval.resolve internal error")
        await conn.enqueue({
            "type": "approval.ack", "ok": False,
            "error": "internal_error", "run_id": run_id,
        })
        return

    await conn.enqueue({
        "type": "approval.ack", "ok": True,
        "run_id": run_id, "session_key": session_key,
        "choice": choice, "resolved": resolved,
    })


@router.post("/api/approvals/resolve")
async def resolve_approval(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)

    session_key = body.get("session_key") or body.get("session_id")
    choice = body.get("choice")

    if not isinstance(session_key, str) or not _SESSION_KEY_RE.match(session_key):
        return web.json_response({"error": "invalid_session_key"}, status=400)
    if not isinstance(choice, str) or choice not in VALID_CHOICES:
        return web.json_response(
            {"error": "invalid_choice", "valid": list(VALID_CHOICES)},
            status=400,
        )

    try:
        resolved = get_bridge().resolve(session_key, choice)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    except Exception:
        logger.exception("[hms.approvals] resolve failed")
        return web.json_response({"error": "internal_error"}, status=500)

    # resolved=0 is legitimate (race after timeout, double-click) — surface as 200.
    return web.json_response({"ok": True, "resolved": resolved, "choice": choice})


def attach(app: web.Application) -> None:
    app.add_routes(router)
