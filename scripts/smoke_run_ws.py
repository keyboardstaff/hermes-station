#!/usr/bin/env python3
"""Smoke test: POST /api/runs then consume the run:<id> stream via WS."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

import aiohttp


def _target() -> tuple:
    """(connector, base_url) — Unix socket when HMS_DEV_SOCK is set (the dev
    default), else TCP on HMS_PORT (default 1313 = production)."""
    sock = os.getenv("HMS_DEV_SOCK")
    if sock:
        return aiohttp.UnixConnector(path=sock), "http://localhost"
    return None, f"http://127.0.0.1:{os.getenv('HMS_PORT', '1313')}"


async def smoke(prompt: str) -> int:
    conn, base = _target()
    ws_url = f"{base}/ws"

    async with aiohttp.ClientSession(connector=conn) as session:
        async with session.post(
            f"{base}/api/runs",
            json={"input": prompt, "reasoning_effort": "low"},
            headers={"X-HMS-CSRF": "1"},
        ) as resp:
            if resp.status >= 400:
                body = await resp.text()
                print(f"✗ POST /api/runs returned {resp.status}: {body}")
                return 1
            data = await resp.json()
            run_id = data["run_id"]
            session_id = data["session_id"]
            print(f"→ POST /api/runs OK — run_id={run_id} session={session_id}")

        async with session.ws_connect(ws_url) as ws:
            await ws.send_json({"type": "ws.subscribe", "channel": f"run:{run_id}"})
            print("→ WS connected + subscribed")

            delta_chars = 0
            tool_events = 0
            completed = False
            failed = False
            async for msg in ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                payload: dict[str, Any] = json.loads(msg.data)
                if payload.get("type") != "run.event":
                    continue
                ev = payload.get("event")
                if ev == "message.delta":
                    delta_chars += len(payload.get("delta") or "")
                    sys.stdout.write(payload.get("delta") or "")
                    sys.stdout.flush()
                elif ev in ("tool.started", "tool.completed"):
                    tool_events += 1
                elif ev == "run.completed":
                    completed = True
                    break
                elif ev == "run.failed":
                    failed = True
                    print(f"\n✗ run failed: {payload.get('error')}")
                    break

            print(f"\n→ stream done: deltas={delta_chars} chars, tool_events={tool_events}")
            if failed:
                return 2
            if not completed:
                print("✗ never saw run.completed")
                return 3

        async with session.get(f"{base}/api/sessions/{session_id}") as resp:
            if resp.status != 200:
                body = await resp.text()
                print(f"✗ GET session: {resp.status} {body}")
                return 4
            row = await resp.json()
            if row.get("source") != "hms":
                print(f"✗ expected source=hms, got {row.get('source')!r}")
                return 5
            print(f"✓ state.db sessions.source = {row['source']}")

    print("\n✓ run stream smoke OK")
    return 0


if __name__ == "__main__":
    prompt = sys.argv[1] if len(sys.argv) > 1 else "say hello in 3 words"
    code = asyncio.run(smoke(prompt))
    sys.exit(code)
