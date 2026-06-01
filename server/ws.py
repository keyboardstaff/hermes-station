"""WebSocket connection manager with thread-safe broadcast for worker callbacks."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from weakref import WeakSet

from aiohttp import WSCloseCode, WSMsgType, web

logger = logging.getLogger(__name__)

WILDCARD = "*"
# aiohttp server-side ping interval for /ws. Set to 20s so a
# backgrounded mobile tab notices a dead socket within ~25s. Mirrored by the
# client's own ping in src/store/ws.ts (PING_INTERVAL_MS) and documented in
# docs/WS_PROTOCOL.md — keep all three in sync.
HEARTBEAT_SECONDS = 20.0
SEND_QUEUE_MAX = 256


class WSConnection:
    def __init__(self, ws: web.WebSocketResponse, *, manager: WSManager) -> None:
        self._ws = ws
        self._manager = manager
        self._subscriptions: set[str] = set()
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=SEND_QUEUE_MAX)
        self._closed = False
        self._pump_task: asyncio.Task | None = None

    @property
    def closed(self) -> bool:
        return self._closed or self._ws.closed

    @property
    def subscriptions(self) -> frozenset[str]:
        return frozenset(self._subscriptions)

    def subscribe(self, channel: str) -> None:
        self._subscriptions.add(channel)

    def unsubscribe(self, channel: str) -> None:
        self._subscriptions.discard(channel)

    def is_subscribed(self, channel: str) -> bool:
        if WILDCARD in self._subscriptions:
            return True
        if channel in self._subscriptions:
            return True
        # "run:abc" matches "run:*" prefix wildcard.
        for sub in self._subscriptions:
            if sub.endswith(":*") and channel.startswith(sub[:-1]):
                return True
        return False

    async def enqueue(self, payload: dict) -> None:
        if self.closed:
            return
        try:
            self._queue.put_nowait(payload)
        except asyncio.QueueFull:
            # Drop oldest to stay responsive — client should reconnect + refetch.
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                self._queue.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    async def _pump(self) -> None:
        try:
            while not self.closed:
                payload = await self._queue.get()
                if self.closed:
                    return
                try:
                    await self._ws.send_json(payload)
                except (ConnectionResetError, RuntimeError):
                    return
                except Exception:
                    logger.exception("[hms.ws] send failed")
                    return
        finally:
            self._closed = True

    async def close(self, code: int = WSCloseCode.OK, message: str = "") -> None:
        self._closed = True
        if self._pump_task and not self._pump_task.done():
            self._pump_task.cancel()
        try:
            await self._ws.close(code=code, message=message.encode())
        except Exception:
            pass


class WSManager:
    def __init__(self) -> None:
        self._connections: WeakSet[WSConnection] = WeakSet()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = asyncio.Lock()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    @property
    def loop(self) -> asyncio.AbstractEventLoop | None:
        return self._loop

    async def register(self, conn: WSConnection) -> None:
        async with self._lock:
            self._connections.add(conn)
        conn._pump_task = asyncio.create_task(conn._pump())

    async def unregister(self, conn: WSConnection) -> None:
        async with self._lock:
            self._connections.discard(conn)
        await conn.close()

    async def shutdown(self) -> None:
        async with self._lock:
            conns = list(self._connections)
            self._connections.clear()
        for c in conns:
            await c.close(WSCloseCode.GOING_AWAY, "server shutdown")

    async def broadcast(self, channel: str, payload: dict) -> int:
        count = 0
        async with self._lock:
            targets = [c for c in self._connections if c.is_subscribed(channel)]
        for c in targets:
            await c.enqueue(payload)
            count += 1
        return count

    def broadcast_threadsafe(self, channel: str, payload: dict) -> None:
        """Schedule broadcast from a worker thread; silently drop if no loop is bound."""
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast(channel, payload), loop)
        except RuntimeError:
            pass


_default: WSManager | None = None


def get_ws_manager() -> WSManager:
    global _default
    if _default is None:
        _default = WSManager()
    return _default


def reset_for_test() -> None:
    global _default
    _default = None


async def drive_connection(
    request: web.Request,
    ws: web.WebSocketResponse,
    * ,
    manager: WSManager,
    on_message: Callable[[WSConnection, dict], Awaitable[None]] | None = None,
    on_subscribe: Callable[[WSConnection, str, int | None], Awaitable[None]] | None = None,
) -> None:
    """Read inbound frames, handle ``ws.*`` infrastructure verbs inline,
    forward everything else to ``on_message`` (the domain dispatcher).

    Infrastructure verbs:
      • ``ws.subscribe``   — add channel; calls ``on_subscribe(conn, channel,
        last_seq)`` if set. ``last_seq`` (optional int) lets the handler replay
        buffered frames the client missed during a brief disconnect.
      • ``ws.unsubscribe`` — remove channel.
      • ``ws.ping``        — send back ``ws.pong``.
    """
    conn = WSConnection(ws, manager=manager)
    await manager.register(conn)
    try:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue
                if not isinstance(data, dict):
                    continue
                kind = data.get("type")
                if kind == "ws.subscribe":
                    ch = data.get("channel")
                    if isinstance(ch, str) and ch:
                        conn.subscribe(ch)
                        if on_subscribe is not None:
                            raw_seq = data.get("last_seq")
                            last_seq = raw_seq if isinstance(raw_seq, int) else None
                            try:
                                await on_subscribe(conn, ch, last_seq)
                            except Exception:
                                logger.exception("[hms.ws] on_subscribe failed")
                elif kind == "ws.unsubscribe":
                    ch = data.get("channel")
                    if isinstance(ch, str) and ch:
                        conn.unsubscribe(ch)
                elif kind == "ws.ping":
                    await conn.enqueue({"type": "ws.pong"})
                else:
                    if on_message is not None:
                        await on_message(conn, data)
            elif msg.type in (WSMsgType.ERROR, WSMsgType.CLOSE, WSMsgType.CLOSED):
                break
    finally:
        await manager.unregister(conn)
