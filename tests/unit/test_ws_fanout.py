"""N parallel WebSocket clients on the same ``run:<id>``."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.ws import get_ws_manager, reset_for_test


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {
            "extra": {"host": "127.0.0.1", "port": 3131},
        }}}),
        encoding="utf-8",
    )
    from server.lib import config_reader
    config_reader.reload()
    reset_for_test()

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    yield f"ws://{host}:{port}/ws"
    await runner.cleanup()
    config_reader.reload()
    reset_for_test()


async def _subscribe(ws: aiohttp.ClientWebSocketResponse, channel: str) -> None:
    await ws.send_json({"type": "ws.subscribe", "channel": channel})


async def _drain_until(
    ws: aiohttp.ClientWebSocketResponse,
    predicate,
    *,
    timeout: float = 2.0,
) -> list[dict[str, Any]]:
    """Read frames until predicate(payload) → True or timeout."""
    collected: list[dict[str, Any]] = []
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            return collected
        msg = await asyncio.wait_for(ws.receive(), timeout=remaining)
        if msg.type != aiohttp.WSMsgType.TEXT:
            continue
        payload = json.loads(msg.data)
        collected.append(payload)
        if predicate(payload):
            return collected


@pytest.mark.asyncio
async def test_five_subscribers_each_see_every_frame(app_server) -> None:
    ws_url = app_server
    channel = "run:smoke-fanout"
    n_clients = 5

    async with aiohttp.ClientSession() as cs:
        sockets = [await cs.ws_connect(ws_url) for _ in range(n_clients)]
        for ws in sockets:
            await _subscribe(ws, channel)
        # Give the server a tick for every subscribe to land.
        await asyncio.sleep(0.05)

        # Server-side broadcast — emulates what runs.py does on every
        # message.delta callback.
        mgr = get_ws_manager()
        sent = 0
        for i in range(7):
            sent += await mgr.broadcast(channel, {
                "type": "run.event",
                "run_id": "smoke-fanout",
                "event": "message.delta",
                "delta": f"chunk-{i}",
            })
        # broadcast() returns count of subscribers per send; total
        # deliveries = 7 sends × 5 subscribers.
        assert sent == 7 * n_clients

        # Each socket should observe all 7 deltas in order.
        for idx, ws in enumerate(sockets):
            frames = await _drain_until(
                ws,
                lambda p: p.get("delta") == "chunk-6",
                timeout=2.0,
            )
            deltas = [f["delta"] for f in frames if f.get("event") == "message.delta"]
            assert deltas == [f"chunk-{i}" for i in range(7)], (
                f"socket #{idx} saw {deltas!r}"
            )

        for ws in sockets:
            await ws.close()


@pytest.mark.asyncio
async def test_wildcard_subscriber_sees_run_and_approval(app_server) -> None:
    """``*`` subscription receives every channel — handy for ops dashboards."""
    ws_url = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.ws_connect(ws_url) as ws:
            await _subscribe(ws, "*")
            await asyncio.sleep(0.05)
            mgr = get_ws_manager()
            await mgr.broadcast("run:abc", {"type": "run.event", "event": "message.delta", "delta": "x"})
            await mgr.broadcast("approval", {"type": "approval.requested", "run_id": "abc"})
            frames = await _drain_until(
                ws,
                lambda p: p.get("type") == "approval.requested",
                timeout=2.0,
            )
        types = [f.get("type") for f in frames]
        assert "run.event" in types
        assert "approval.requested" in types


@pytest.mark.asyncio
async def test_late_subscriber_misses_earlier_frames(app_server) -> None:
    """No replay — frames published before subscribe are lost on purpose."""
    ws_url = app_server
    channel = "run:late"
    mgr = get_ws_manager()
    await mgr.broadcast(channel, {"type": "run.event", "delta": "lost"})

    async with aiohttp.ClientSession() as cs:
        async with cs.ws_connect(ws_url) as ws:
            await _subscribe(ws, channel)
            await asyncio.sleep(0.05)
            await mgr.broadcast(channel, {"type": "run.event", "delta": "seen"})
            frames = await _drain_until(
                ws,
                lambda p: p.get("delta") == "seen",
                timeout=1.5,
            )
        deltas = [f.get("delta") for f in frames if "delta" in f]
        assert "seen" in deltas
        assert "lost" not in deltas
