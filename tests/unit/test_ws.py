"""WSManager unit tests — subscription routing + thread-safe broadcast."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from server import ws as ws_mod
from server.ws import WILDCARD, WSConnection, WSManager, reset_for_test


class FakeWS:
    """Mimics web.WebSocketResponse just enough for WSConnection."""
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.closed = False

    async def send_json(self, payload: dict) -> None:
        if self.closed:
            raise ConnectionResetError("closed")
        self.sent.append(payload)

    async def close(self, code: int = 0, message: bytes = b"") -> None:
        self.closed = True


@pytest.fixture(autouse=True)
def _reset():
    reset_for_test()
    yield
    reset_for_test()


# subscription routing


@pytest.mark.asyncio
async def test_broadcast_only_to_subscribed() -> None:
    mgr = WSManager()
    a = WSConnection(FakeWS(), manager=mgr)  # type: ignore[arg-type]
    b = WSConnection(FakeWS(), manager=mgr)  # type: ignore[arg-type]
    a.subscribe("run:abc")
    b.subscribe("run:xyz")
    await mgr.register(a)
    await mgr.register(b)

    sent = await mgr.broadcast("run:abc", {"type": "run.event", "run_id": "abc"})
    assert sent == 1

    # Let the pump task flush.
    for _ in range(10):
        if a._ws.sent:  # type: ignore[attr-defined]
            break
        await asyncio.sleep(0.01)
    assert a._ws.sent == [{"type": "run.event", "run_id": "abc"}]  # type: ignore[attr-defined]
    assert b._ws.sent == []  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_wildcard_receives_everything() -> None:
    mgr = WSManager()
    star = WSConnection(FakeWS(), manager=mgr)  # type: ignore[arg-type]
    star.subscribe(WILDCARD)
    await mgr.register(star)
    await mgr.broadcast("run:abc", {"type": "ping"})
    await mgr.broadcast("logs:agent", {"type": "log.line"})
    for _ in range(20):
        if len(star._ws.sent) >= 2:  # type: ignore[attr-defined]
            break
        await asyncio.sleep(0.01)
    assert len(star._ws.sent) == 2  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_prefix_wildcard_subscription() -> None:
    mgr = WSManager()
    conn = WSConnection(FakeWS(), manager=mgr)  # type: ignore[arg-type]
    conn.subscribe("run:*")
    await mgr.register(conn)
    await mgr.broadcast("run:abc", {"v": 1})
    await mgr.broadcast("logs:agent", {"v": 2})
    for _ in range(20):
        if conn._ws.sent:  # type: ignore[attr-defined]
            break
        await asyncio.sleep(0.01)
    assert conn._ws.sent == [{"v": 1}]  # type: ignore[attr-defined]


# thread-safe broadcast


@pytest.mark.asyncio
async def test_broadcast_threadsafe_marshals_to_loop() -> None:
    mgr = WSManager()
    conn = WSConnection(FakeWS(), manager=mgr)  # type: ignore[arg-type]
    conn.subscribe("x")
    await mgr.register(conn)
    mgr.bind_loop(asyncio.get_running_loop())

    import threading

    def _worker() -> None:
        mgr.broadcast_threadsafe("x", {"from": "thread"})

    t = threading.Thread(target=_worker)
    t.start()
    t.join()

    for _ in range(20):
        if conn._ws.sent:  # type: ignore[attr-defined]
            break
        await asyncio.sleep(0.01)
    assert conn._ws.sent == [{"from": "thread"}]  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_broadcast_threadsafe_silently_drops_when_no_loop() -> None:
    mgr = WSManager()
    # No bind_loop() call.
    mgr.broadcast_threadsafe("x", {"v": 1})  # should not raise


# queue overflow


@pytest.mark.asyncio
async def test_send_queue_drops_oldest_on_overflow() -> None:
    mgr = WSManager()
    fake = FakeWS()
    conn = WSConnection(fake, manager=mgr)  # type: ignore[arg-type]
    conn.subscribe("x")
    # Don't register — keeps pump from draining; we want to fill the queue.
    # Enqueue more than capacity (SEND_QUEUE_MAX = 256).
    for i in range(ws_mod.SEND_QUEUE_MAX + 5):
        await conn.enqueue({"i": i})
    # Queue should be at most SEND_QUEUE_MAX.
    assert conn._queue.qsize() <= ws_mod.SEND_QUEUE_MAX  # type: ignore[attr-defined]
