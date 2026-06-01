"""WebSocket reconnection contract tests."""

from __future__ import annotations

import asyncio
from pathlib import Path

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


@pytest.mark.asyncio
async def test_reconnect_replays_subscription(app_server) -> None:
    """A client that disconnects + reconnects + re-subscribes still."""
    ws_url = app_server
    mgr = get_ws_manager()

    async with aiohttp.ClientSession() as cs:
        # First connection — subscribe, then close.
        async with cs.ws_connect(ws_url) as ws1:
            await ws1.send_json({"type": "ws.subscribe", "channel": "run:r1"})
            await asyncio.sleep(0.05)
            await ws1.close()

        # The manager must NOT panic when the broadcast fires with no
        # subscribers — it's a 0-recipient broadcast, return 0.
        n = await mgr.broadcast("run:r1", {"type": "run.event", "delta": "ignored"})
        assert n == 0

        # Reconnect, re-subscribe, then verify deliveries resume.
        async with cs.ws_connect(ws_url) as ws2:
            await ws2.send_json({"type": "ws.subscribe", "channel": "run:r1"})
            await asyncio.sleep(0.05)
            n = await mgr.broadcast("run:r1", {"type": "run.event", "delta": "after-reconnect"})
            assert n == 1

            # Receive the frame we just broadcast.
            msg = await asyncio.wait_for(ws2.receive(), timeout=2.0)
            assert msg.type == aiohttp.WSMsgType.TEXT
            import json
            payload = json.loads(msg.data)
            assert payload.get("delta") == "after-reconnect"


@pytest.mark.asyncio
async def test_shutdown_closes_every_connection(app_server) -> None:
    """``manager.shutdown()`` (used by adapter.disconnect during a."""
    ws_url = app_server
    mgr = get_ws_manager()
    async with aiohttp.ClientSession() as cs:
        sockets = [await cs.ws_connect(ws_url) for _ in range(3)]
        for ws in sockets:
            await ws.send_json({"type": "ws.subscribe", "channel": "run:s"})
        await asyncio.sleep(0.05)

        await mgr.shutdown()

        # Each socket should receive a close frame within a beat.
        for ws in sockets:
            for _ in range(20):
                msg = await asyncio.wait_for(ws.receive(), timeout=2.0)
                if msg.type in (
                    aiohttp.WSMsgType.CLOSE,
                    aiohttp.WSMsgType.CLOSED,
                    aiohttp.WSMsgType.CLOSING,
                ):
                    break
            assert ws.closed


@pytest.mark.asyncio
async def test_subscribe_replays_buffered_run_frames(app_server) -> None:
    """Re-subscribing to run:<id> with last_seq replays only newer frames
    from the handle's ring buffer (covers frames dropped during an outage)."""
    import json

    from server import runs

    ws_url = app_server
    handle = runs.RunHandle(
        run_id="run_replaytest", session_id="sess_replay",
        status="running", created_at=0.0,
    )
    for ch in ("a", "b", "c"):
        handle.stamp({"type": "run.event", "run_id": handle.run_id,
                      "event": "message.delta", "delta": ch})
    await runs.get_registry().add(handle)
    try:
        async with aiohttp.ClientSession() as cs:
            async with cs.ws_connect(ws_url) as ws:
                # Client already saw seq=1 ("a") → expect "b" and "c" replayed.
                await ws.send_json({
                    "type": "ws.subscribe",
                    "channel": f"run:{handle.run_id}",
                    "last_seq": 1,
                })
                deltas = []
                for _ in range(2):
                    msg = await asyncio.wait_for(ws.receive(), timeout=2.0)
                    assert msg.type == aiohttp.WSMsgType.TEXT
                    deltas.append(json.loads(msg.data)["delta"])
                assert deltas == ["b", "c"]
    finally:
        await runs.get_registry().remove(handle.run_id)
