"""Station preferences — owner-level pinned sessions persisted server-side so
they sync across browsers/devices.

Lib paths route through ``hms_data_dir()`` (under ``hermes_home()``);
``quiet_hms_env`` points that at a per-test tmp dir, so these never touch a real
~/.hermes. Route tests stand up the real app so CSRF + JSON handling are covered.
"""

from __future__ import annotations

from pathlib import Path

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.lib import station_prefs

# ── lib ──────────────────────────────────────────────────────────────


def test_get_pinned_empty_when_no_file(quiet_hms_env) -> None:
    assert station_prefs.get_pinned() == []


def test_set_then_get_roundtrip(quiet_hms_env) -> None:
    stored = station_prefs.set_pinned(["s1", "s2", "s3"])
    assert stored == ["s1", "s2", "s3"]
    assert station_prefs.get_pinned() == ["s1", "s2", "s3"]


def test_set_dedups_and_drops_empties_order_preserving(quiet_hms_env) -> None:
    stored = station_prefs.set_pinned(["s1", "", "s2", "s1", "s3", "s2"])
    assert stored == ["s1", "s2", "s3"]


def test_set_caps_length(quiet_hms_env) -> None:
    stored = station_prefs.set_pinned([f"s{i}" for i in range(station_prefs._PINNED_MAX + 50)])
    assert len(stored) == station_prefs._PINNED_MAX


def test_get_tolerates_corrupt_file(quiet_hms_env) -> None:
    from server.lib.upstream_paths import hms_data_dir

    (hms_data_dir() / "preferences.json").write_text("{not json", encoding="utf-8")
    assert station_prefs.get_pinned() == []


def test_set_preserves_other_keys(quiet_hms_env) -> None:
    import json

    from server.lib.upstream_paths import hms_data_dir

    path = hms_data_dir() / "preferences.json"
    path.write_text(json.dumps({"some_future_key": 7, "pinned_sessions": ["old"]}), encoding="utf-8")
    station_prefs.set_pinned(["new"])
    data = json.loads(path.read_text("utf-8"))
    assert data["pinned_sessions"] == ["new"]
    assert data["some_future_key"] == 7  # unrelated prefs survive a write


# ── route ────────────────────────────────────────────────────────────


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {
            "host": "127.0.0.1",
            "port": 3131,
        }}}}),
        encoding="utf-8",
    )
    from server.lib import config_reader
    config_reader.reload()

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    base = f"http://{host}:{port}"
    try:
        yield base
    finally:
        await runner.cleanup()
        config_reader.reload()


@pytest.mark.asyncio
async def test_route_get_empty_initially(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/preferences/pinned") as r:
            assert r.status == 200
            assert await r.json() == {"pinned": []}


@pytest.mark.asyncio
async def test_route_put_persists_and_get_reflects(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{app_server}/api/preferences/pinned",
            json={"pinned": ["a", "b", "a", ""]},  # dup + empty cleaned server-side
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 200
            assert await r.json() == {"pinned": ["a", "b"]}
        async with cs.get(f"{app_server}/api/preferences/pinned") as r:
            assert await r.json() == {"pinned": ["a", "b"]}


@pytest.mark.asyncio
async def test_route_put_rejects_non_list(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{app_server}/api/preferences/pinned",
            json={"pinned": "nope"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400
            assert (await r.json())["error"] == "pinned_must_be_list"


@pytest.mark.asyncio
async def test_route_put_rejects_invalid_json(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{app_server}/api/preferences/pinned",
            data=b"not json",
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400
            assert (await r.json())["error"] == "invalid_json"


@pytest.mark.asyncio
async def test_route_put_requires_csrf(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{app_server}/api/preferences/pinned",
            json={"pinned": ["a"]},
        ) as r:
            assert r.status == 403  # csrf_middleware blocks mutations without the header
