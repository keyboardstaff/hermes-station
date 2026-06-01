"""Analytics route tests — mocks the db() singleton."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app


def _build_fake_db(rows: list[dict]):
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE sessions (
            session_id TEXT PRIMARY KEY,
            source     TEXT,
            input_tokens  INTEGER,
            output_tokens INTEGER,
            started_at    REAL
        )
    """)
    now = time.time()
    for r in rows:
        conn.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
            (
                r.get("session_id", f"s-{id(r)}"),
                r.get("source"),
                r.get("input_tokens", 0),
                r.get("output_tokens", 0),
                r.get("started_at", now),
            ),
        )
    conn.commit()
    fake = MagicMock()
    fake._conn = conn
    return fake


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    """Boot station with the analytics route wired."""
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
async def test_sources_happy_path(app_server) -> None:
    """Returns grouped source distribution from state.db."""
    now = time.time()
    fake = _build_fake_db([
        {"session_id": "s1", "source": "hms", "input_tokens": 100, "output_tokens": 50, "started_at": now - 3600},
        {"session_id": "s2", "source": "hms", "input_tokens": 200, "output_tokens": 100, "started_at": now - 7200},
        {"session_id": "s3", "source": "telegram", "input_tokens": 50, "output_tokens": 25, "started_at": now - 1800},
        {"session_id": "s4", "source": None, "input_tokens": 10, "output_tokens": 5, "started_at": now - 900},
    ])

    with patch("server.routes.analytics.db", return_value=fake):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/analytics/sources") as r:
                assert r.status == 200
                data = await r.json()

    assert data["period_days"] == 30
    sources = data["sources"]
    assert len(sources) == 3  # station, telegram, unknown

    # station has the most sessions
    ws = next(s for s in sources if s["source"] == "hms")
    assert ws["sessions"] == 2
    assert ws["total_tokens"] == 450  # (100+50) + (200+100)

    tg = next(s for s in sources if s["source"] == "telegram")
    assert tg["sessions"] == 1

    unk = next(s for s in sources if s["source"] == "unknown")
    assert unk["sessions"] == 1


@pytest.mark.asyncio
async def test_sources_custom_days(app_server) -> None:
    """?days=7 filters out old sessions."""
    now = time.time()
    fake = _build_fake_db([
        {"session_id": "recent", "source": "hms", "input_tokens": 100, "output_tokens": 50, "started_at": now - 3600},
        {"session_id": "old", "source": "hms", "input_tokens": 999, "output_tokens": 999, "started_at": now - 30 * 86400},
    ])

    with patch("server.routes.analytics.db", return_value=fake):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/analytics/sources?days=7") as r:
                assert r.status == 200
                data = await r.json()

    assert data["period_days"] == 7
    # Only the recent session should be included
    assert len(data["sources"]) == 1
    assert data["sources"][0]["sessions"] == 1


@pytest.mark.asyncio
async def test_sources_db_unavailable(app_server) -> None:
    """When state.db is unreachable, returns empty list gracefully."""
    with patch("server.routes.analytics.db", side_effect=RuntimeError("no db")):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/analytics/sources") as r:
                assert r.status == 200
                data = await r.json()

    assert data["sources"] == []
    assert "error" in data
    assert data["error"] == "db_unavailable"


@pytest.mark.asyncio
async def test_sources_bad_days_defaults_to_30(app_server) -> None:
    """Invalid days param falls back to 30."""
    fake = _build_fake_db([])

    with patch("server.routes.analytics.db", return_value=fake):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/analytics/sources?days=abc") as r:
                assert r.status == 200
                data = await r.json()

    assert data["period_days"] == 30


@pytest.mark.asyncio
async def test_sources_empty_db(app_server) -> None:
    """Empty sessions table returns empty sources list."""
    fake = _build_fake_db([])

    with patch("server.routes.analytics.db", return_value=fake):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/analytics/sources") as r:
                assert r.status == 200
                data = await r.json()

    assert data["sources"] == []
    assert data["period_days"] == 30
