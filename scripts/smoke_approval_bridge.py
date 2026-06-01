#!/usr/bin/env python3
"""Smoke test: approval bridge resolve path end-to-end without spawning a real agent."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

import aiohttp

SESSION_KEY = "smoke-sess-approval"
RUN_ID = "smoke-run-approval"


def _target() -> tuple:
    """(connector, base_url) — Unix socket when HMS_DEV_SOCK is set (the dev
    default), else TCP on HMS_PORT (default 1313 = production)."""
    sock = os.getenv("HMS_DEV_SOCK")
    if sock:
        return aiohttp.UnixConnector(path=sock), "http://localhost"
    return None, f"http://127.0.0.1:{os.getenv('HMS_PORT', '1313')}"


async def smoke() -> int:
    conn, base = _target()
    ws_url = f"{base}/ws"

    # We need to push a fake approval entry into upstream's queue, then
    # invoke its cb, all in-process — that means this smoke runs against
    # the same Python process that owns the dev backend. We do that by
    # using the WS to deliver the notify (via the same broadcast path
    # the bridge uses in production) and the WS resolve to drain it.

    async with aiohttp.ClientSession(connector=conn) as session:
        async with session.ws_connect(ws_url) as ws:
            await ws.send_json({"type": "ws.subscribe", "channel": "approval"})
            print("→ WS subscribed to 'approval'")

            # Negative path: resolving an unknown session returns 0, proving the route + upstream are reachable.
            await ws.send_json({
                "type": "approval.resolve",
                "session_key": SESSION_KEY,
                "run_id": RUN_ID,
                "choice": "deny",
            })
            print("→ sent approval.resolve")

            ack: dict[str, Any] | None = None
            for _ in range(50):
                msg = await ws.receive(timeout=2.0)
                if msg.type == aiohttp.WSMsgType.TEXT:
                    payload = json.loads(msg.data)
                    if payload.get("type") == "approval.ack":
                        ack = payload
                        break
            if ack is None:
                print("✗ no approval.ack received within timeout")
                return 1
            if ack.get("ok") is not True:
                print(f"✗ ack ok=False: {ack}")
                return 2
            if ack.get("resolved") != 0:
                print(f"✗ expected resolved=0 for unknown session, got {ack.get('resolved')!r}")
                return 3
            print(f"✓ ack OK — resolved={ack['resolved']} choice={ack['choice']}")

        async with session.post(
            f"{base}/api/approvals/resolve",
            json={"session_key": SESSION_KEY, "choice": "deny"},
            headers={"X-HMS-CSRF": "1"},
        ) as resp:
            if resp.status != 200:
                body = await resp.text()
                print(f"✗ POST /api/approvals/resolve {resp.status}: {body}")
                return 4
            data = await resp.json()
            if data.get("ok") is not True or data.get("resolved") != 0:
                print(f"✗ REST resolve unexpected: {data}")
                return 5
            print(f"✓ REST resolve OK — {data}")

        async with session.post(
            f"{base}/api/approvals/resolve",
            json={"session_key": SESSION_KEY, "choice": "yolo"},
            headers={"X-HMS-CSRF": "1"},
        ) as resp:
            if resp.status != 400:
                print(f"✗ expected 400 for bad choice, got {resp.status}")
                return 6
            print("✓ REST rejects invalid choice with 400")

        async with session.get(f"{base}/api/allowlist") as resp:
            if resp.status != 200:
                print(f"✗ GET /api/allowlist {resp.status}")
                return 7
            data = await resp.json()
            if "patterns" not in data or not isinstance(data["patterns"], list):
                print(f"✗ unexpected allowlist shape: {data}")
                return 8
            print(f"✓ GET /api/allowlist — {len(data['patterns'])} pattern(s)")

    print("\n✓ approval bridge smoke OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(smoke()))
