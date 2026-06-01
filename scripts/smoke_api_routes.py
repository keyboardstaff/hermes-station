#!/usr/bin/env python3
"""Smoke test — exercises API routes against a running dev backend; writes guarded by --write."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

import aiohttp

CSRF = {"X-HMS-CSRF": "1"}


def _target() -> tuple:
    """(connector, base_url) — Unix socket when HMS_DEV_SOCK is set (the dev
    default), else TCP on HMS_PORT (default 1313 = production)."""
    sock = os.getenv("HMS_DEV_SOCK")
    if sock:
        return aiohttp.UnixConnector(path=sock), "http://localhost"
    return None, f"http://127.0.0.1:{os.getenv('HMS_PORT', '1313')}"


async def smoke(write: bool) -> int:
    conn, base = _target()

    async with aiohttp.ClientSession(connector=conn) as cs:
        async with cs.get(f"{base}/api/settings") as r:
            data = await r.json()
            assert r.status == 200, (r.status, data)
            assert "password_hash" not in data, data
            print(f"✓ GET  /api/settings — port={data.get('port')} password_set={data.get('password_set')}")

        async with cs.get(f"{base}/api/config") as r:
            data = await r.json()
            assert r.status == 200, (r.status, data)
            print(
                f"✓ GET  /api/config — model_default={data.get('model_default')!r} "
                f"personalities={len(data.get('personalities') or [])}"
            )

        async with cs.get(f"{base}/api/models") as r:
            data = await r.json()
            assert r.status == 200, (r.status, data)
            print(
                f"✓ GET  /api/models — providers={len(data.get('providers') or [])} "
                f"models={len(data.get('models') or [])}"
            )

        async with cs.get(f"{base}/api/profiles") as r:
            data = await r.json()
            assert r.status == 200, (r.status, data)
            profiles = data.get("profiles") or []
            print(f"✓ GET  /api/profiles — {len(profiles)} profiles")
        default = next((p for p in profiles if p.get("is_default")), profiles[0] if profiles else None)

        if default:
            name = default["name"]
            for tab in ("memory", "user"):
                async with cs.get(f"{base}/api/profiles/{name}/memory/{tab}") as r:
                    assert r.status == 200, (tab, r.status)
                    data = await r.json()
                    print(f"✓ GET  /api/profiles/{name}/memory/{tab} — {len(data['content'])} chars")

            async with cs.get(f"{base}/api/profiles/{name}/memory/etc") as r:
                assert r.status == 400, r.status
                print("✓ rejects unknown memory tab with 400")

        async with cs.get(f"{base}/api/fs/logs/agent?tail=5") as r:
            data = await r.json()
            assert r.status == 200, (r.status, data)
            print(f"✓ GET  /api/fs/logs/agent?tail=5 — {len(data['lines'])} lines")

        async with cs.get(f"{base}/api/fs/logs/secrets?tail=5") as r:
            assert r.status == 400, r.status
            print("✓ rejects unknown log name with 400")

        if write:
            print("\n--- destructive writes (--write) ---")
            async with cs.patch(
                f"{base}/api/settings",
                json={"session_ttl_seconds": 3600},
                headers={**CSRF, "Content-Type": "application/json"},
            ) as r:
                data = await r.json()
                assert r.status == 200, (r.status, data)
                assert data["written"]["session_ttl_seconds"] == 3600
                print("✓ PATCH /api/settings — wrote session_ttl_seconds=3600")

    print("\n✓ API routes smoke OK")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="enable PATCH/PUT writes")
    args = ap.parse_args()
    sys.exit(asyncio.run(smoke(write=args.write)))
