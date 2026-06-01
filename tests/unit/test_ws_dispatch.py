"""Tests for the dynamic WS dispatch registry."""

from __future__ import annotations

from typing import Any

import pytest
from server import ws_dispatch
from server.ws import WSConnection, WSManager
from server.ws import reset_for_test as reset_ws


class FakeWS:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.closed = False

    async def send_json(self, payload: dict) -> None:
        if self.closed:
            raise ConnectionResetError("closed")
        self.sent.append(payload)

    async def close(self, code: int = 0, message: bytes = b"") -> None:
        self.closed = True


def _make_conn() -> WSConnection:
    mgr = WSManager()
    return WSConnection(FakeWS(), manager=mgr)  # type: ignore[arg-type]


@pytest.fixture(autouse=True)
def _reset() -> None:
    reset_ws()
    ws_dispatch.reset_for_test()
    yield
    reset_ws()
    ws_dispatch.reset_for_test()


@pytest.mark.asyncio
async def test_register_then_dispatch_invokes_handler() -> None:
    calls: list[dict] = []

    @ws_dispatch.register("foo.bar")
    async def _handle(conn: WSConnection, payload: dict) -> None:
        calls.append(payload)

    conn = _make_conn()
    await ws_dispatch.dispatch(conn, {"type": "foo.bar", "x": 1})

    assert calls == [{"type": "foo.bar", "x": 1}]
    assert ws_dispatch.registered_types() == ["foo.bar"]


@pytest.mark.asyncio
async def test_duplicate_register_raises() -> None:
    @ws_dispatch.register("dup")
    async def _first(conn: WSConnection, payload: dict) -> None:
        pass

    with pytest.raises(RuntimeError, match="duplicate handler"):
        @ws_dispatch.register("dup")
        async def _second(conn: WSConnection, payload: dict) -> None:  # noqa: F811
            pass


@pytest.mark.asyncio
async def test_unknown_type_is_silently_dropped() -> None:
    # No handler registered. dispatch() must return cleanly — clients
    # that send something we don't recognise shouldn't crash the server.
    conn = _make_conn()
    await ws_dispatch.dispatch(conn, {"type": "never.registered"})
    # No assertion beyond "no exception".


@pytest.mark.asyncio
async def test_handler_exception_is_swallowed() -> None:
    @ws_dispatch.register("boom")
    async def _bad(conn: WSConnection, payload: dict) -> None:
        raise RuntimeError("intentional")

    conn = _make_conn()
    # Must not propagate — a single broken handler can't take the loop down.
    await ws_dispatch.dispatch(conn, {"type": "boom"})


@pytest.mark.asyncio
async def test_missing_or_non_string_type_returns_silently() -> None:
    conn = _make_conn()
    await ws_dispatch.dispatch(conn, {})
    await ws_dispatch.dispatch(conn, {"type": 42})  # type: ignore[dict-item]
    await ws_dispatch.dispatch(conn, {"type": None})  # type: ignore[dict-item]
