"""WebSocket route — handshake auth + dispatch to registered handlers.

The if-chain that used to live here was retired; domain verbs
(``run.stop`` / ``approval.resolve``) now register themselves in their
own route modules via ``@server.ws_dispatch.register``. This file is
just the HTTP upgrade + plumbing.

Importing the route modules at module load is what makes their
``@register`` decorators run before the first connection lands.
"""

from __future__ import annotations

import logging

from aiohttp import web

from server import auth
from server.lib import config_reader
from server.lib.session_store import get_default_store

# Side-effect imports — let the @register decorators populate the
# dispatch registry before any WS frame arrives.
from server.routes import approvals as _approvals_routes  # noqa: F401
from server.routes import runs as _runs_routes  # noqa: F401
from server.ws import HEARTBEAT_SECONDS, WSConnection, drive_connection, get_ws_manager
from server.ws_dispatch import dispatch

logger = logging.getLogger(__name__)

router = web.RouteTableDef()


async def _is_authorized(request: web.Request) -> bool:
    if not config_reader.hms_password_hash():
        return True
    if auth.is_localhost(request):
        return True
    token = request.cookies.get(auth.SESSION_COOKIE_NAME, "")
    if not token:
        return False
    return await get_default_store().is_valid(token)


@router.get("/ws")
async def ws_handler(request: web.Request) -> web.StreamResponse:
    # Reject before upgrade so browsers see a real 401; auth_middleware skips /ws.
    if not await _is_authorized(request):
        return web.Response(status=401, text='{"error": "unauthorized"}',
                            content_type="application/json")

    # Keep a 20s heartbeat so mobile background -> foreground transitions
    # notice a dead socket faster.
    ws = web.WebSocketResponse(heartbeat=HEARTBEAT_SECONDS)
    await ws.prepare(request)

    manager = get_ws_manager()

    async def _on_subscribe(
        conn: WSConnection, channel: str, last_seq: int | None = None,
    ) -> None:
        # Replay buffered run frames a brief WS outage dropped: the client
        # re-subscribes with the highest seq it saw; we resend everything newer.
        if channel.startswith("run:"):
            run_id = channel[len("run:"):]
            if run_id:
                from server import runs
                handle = await runs.get_registry().get(run_id)
                if handle is not None:
                    for frame in handle.replay_since(last_seq or 0):
                        await conn.enqueue(frame)
            return
        # Replay pending approvals so a brief WS outage doesn't strand a blocked agent thread.
        if channel != "approval" and channel != "*":
            return
        from server.approvals import get_bridge
        for payload in get_bridge().list_pending():
            await conn.enqueue(payload)

    await drive_connection(
        request, ws, manager=manager,
        on_message=dispatch, on_subscribe=_on_subscribe,
    )
    return ws


def attach(app: web.Application) -> None:
    app.router.add_routes(router)


__all__ = ["attach"]
