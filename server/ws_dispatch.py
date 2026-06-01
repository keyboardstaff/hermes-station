"""Dynamic WS message dispatch — domain routes register handlers in-place.

Replaces the old if-chain in ``server/routes/ws.py``
so adding a new message type touches exactly one file (the domain
route) instead of three (route + types + routes/ws.py).

Lifecycle infrastructure messages (``ws.subscribe`` / ``ws.unsubscribe``
/ ``ws.ping``) are NOT routed through this dispatcher — they mutate the
connection's subscription state and live inline in
``server/ws.drive_connection``. The dispatcher only handles domain
verbs like ``run.stop`` and ``approval.resolve`` that need access to
domain modules.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from server.ws import WSConnection

logger = logging.getLogger(__name__)

Handler = Callable[[WSConnection, dict], Awaitable[None]]

_HANDLERS: dict[str, Handler] = {}


def register(msg_type: str) -> Callable[[Handler], Handler]:
    """Decorator: ``@register("run.stop")`` exposes the wrapped coroutine
    as the dispatch target for ``payload["type"] == "run.stop"``.

    Raises ``RuntimeError`` if a duplicate handler is registered — keeps
    domain routes honest (one type, one handler).
    """
    def _decorator(fn: Handler) -> Handler:
        if msg_type in _HANDLERS:
            raise RuntimeError(f"[hms.ws_dispatch] duplicate handler for {msg_type!r}")
        _HANDLERS[msg_type] = fn
        return fn
    return _decorator


async def dispatch(conn: WSConnection, payload: dict) -> None:
    """Look up + invoke the handler for ``payload['type']``. Unknown
    types are silently dropped — the spec is closed-vocabulary; a
    client that sends something we don't recognise is buggy and the
    server should not crash on it."""
    msg_type = payload.get("type")
    if not isinstance(msg_type, str):
        return
    fn = _HANDLERS.get(msg_type)
    if fn is None:
        logger.debug("[hms.ws_dispatch] no handler for %r", msg_type)
        return
    try:
        await fn(conn, payload)
    except Exception:
        logger.exception("[hms.ws_dispatch] handler %r raised", msg_type)


def reset_for_test() -> None:
    """Clear the handler registry — call from test fixtures."""
    _HANDLERS.clear()


def registered_types() -> list[str]:
    """Snapshot of currently-registered handler types. Test helper."""
    return sorted(_HANDLERS.keys())


__all__ = ["register", "dispatch", "reset_for_test", "registered_types"]
