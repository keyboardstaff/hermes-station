"""End-to-end approval lifecycle test (in-process, real aiohttp)."""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any

import aiohttp
import pytest
from aiohttp import web
from server import approvals as approvals_mod
from server.app import build_app
from server.approvals import APPROVAL_CHANNEL, get_bridge
from server.ws import reset_for_test as reset_ws

# End-to-end against the real upstream approval flow. Skips where
# hermes-agent is absent (CI); runs locally under scripts/test.sh.
pytest.importorskip(
    "tools.approval",
    reason="requires upstream hermes-agent (tools.approval)",
)


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path):
    """Boot the real app on an ephemeral port."""
    reset_ws()
    approvals_mod.reset_for_test()
    from tools import approval as A
    with A._lock:
        A._gateway_queues.clear()
        A._gateway_notify_cbs.clear()

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    # Discover the assigned port.
    sockets = runner.addresses  # list[tuple[str,int]]
    host, port = sockets[0][0], sockets[0][1]
    base = f"http://{host}:{port}"
    ws_url = f"ws://{host}:{port}/ws"

    try:
        yield base, ws_url
    finally:
        await runner.cleanup()
        reset_ws()
        approvals_mod.reset_for_test()
        with A._lock:
            A._gateway_queues.clear()
            A._gateway_notify_cbs.clear()


@pytest.mark.asyncio
async def test_full_approval_roundtrip_via_ws(app_server) -> None:
    base, ws_url = app_server
    bridge = get_bridge()
    session_key = "itest-sess-1"
    run_id = "itest-run-1"

    async with aiohttp.ClientSession() as cs:
        async with cs.ws_connect(ws_url) as ws:
            await ws.send_json({"type": "ws.subscribe", "channel": APPROVAL_CHANNEL})
            # Give the server a tick to apply the subscription.
            await asyncio.sleep(0.05)

            # Register the bridge — must happen AFTER the WS subscribes
            # so the upstream cb knows where to fan out to.
            bridge.register(session_key, run_id)

            # Push a queue entry (mimicking what check_all_command_guards
            # does internally) and trigger the notify cb on a worker
            # thread (which is where AIAgent would call it from).
            from tools import approval as A
            entry = A._ApprovalEntry({
                "command": "rm -rf /tmp/foo",
                "pattern_key": "rm_rf",
                "pattern_keys": ["rm_rf"],
                "description": "dangerous filesystem command",
            })
            with A._lock:
                A._gateway_queues.setdefault(session_key, []).append(entry)
                cb = A._gateway_notify_cbs[session_key]

            def _fire() -> None:
                cb({
                    "command": "rm -rf /tmp/foo",
                    "description": "dangerous filesystem command",
                    "pattern_key": "rm_rf",
                    "pattern_keys": ["rm_rf"],
                })

            t = threading.Thread(target=_fire)
            t.start()
            t.join()

            # Receive the approval.requested frame.
            request_msg: dict[str, Any] | None = None
            for _ in range(20):
                msg = await ws.receive(timeout=1.0)
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                payload = json.loads(msg.data)
                if payload.get("type") == "approval.requested":
                    request_msg = payload
                    break
            assert request_msg is not None, "expected approval.requested frame"
            assert request_msg["run_id"] == run_id
            assert request_msg["session_key"] == session_key
            assert request_msg["pattern_key"] == "rm_rf"

            # Resolve over WS as "once" (no allowlist write).
            await ws.send_json({
                "type": "approval.resolve",
                "session_key": session_key,
                "run_id": run_id,
                "choice": "once",
            })
            ack: dict[str, Any] | None = None
            for _ in range(20):
                msg = await ws.receive(timeout=1.0)
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                payload = json.loads(msg.data)
                if payload.get("type") == "approval.ack":
                    ack = payload
                    break
            assert ack is not None
            assert ack["ok"] is True
            assert ack["resolved"] == 1
            assert ack["choice"] == "once"

            # The entry should now be flagged.
            assert entry.event.is_set()
            assert entry.result == "once"

            bridge.unregister(session_key)


@pytest.mark.asyncio
async def test_rest_fallback_resolves(app_server) -> None:
    base, _ = app_server
    bridge = get_bridge()
    session_key = "itest-rest-1"
    bridge.register(session_key, "rid-rest")

    from tools import approval as A
    entry = A._ApprovalEntry({
        "command": "sudo rm",
        "pattern_key": "sudo",
        "pattern_keys": ["sudo"],
        "description": "elevation",
    })
    with A._lock:
        A._gateway_queues.setdefault(session_key, []).append(entry)

    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{base}/api/approvals/resolve",
            json={"session_key": session_key, "choice": "deny"},
            headers={"X-HMS-CSRF": "1"},
        ) as resp:
            assert resp.status == 200
            data = await resp.json()
            assert data["ok"] is True
            assert data["resolved"] == 1
            assert data["choice"] == "deny"

    assert entry.event.is_set()
    assert entry.result == "deny"

    bridge.unregister(session_key)
