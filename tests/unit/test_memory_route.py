"""Structured-memory route — view + delete the holographic provider's facts.

The real ``MemoryStore`` is swapped for a fake (the route reads
``shim.memory.MemoryStore`` at call time), and the per-profile
``memory_store.db`` is a touched file under the ``quiet_hms_env`` tmp home so
``path.exists()`` is true without a real holographic db.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.lib.upstream_shim import shim


class _FakeStore:
    """In-memory stand-in for holographic's MemoryStore (list_facts/remove_fact)."""

    facts: list[dict] = []

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path

    def __enter__(self) -> _FakeStore:
        return self

    def __exit__(self, *_: object) -> None:
        pass

    def list_facts(self, category=None, min_trust=0.0, limit=50) -> list[dict]:
        return list(_FakeStore.facts)

    def remove_fact(self, fact_id: int) -> bool:
        before = len(_FakeStore.facts)
        _FakeStore.facts = [f for f in _FakeStore.facts if f["fact_id"] != fact_id]
        return len(_FakeStore.facts) < before


def _fact(fid: int, content: str) -> dict:
    return {
        "fact_id": fid, "content": content, "category": "general", "tags": "x",
        "trust_score": 0.7, "retrieval_count": 2, "helpful_count": 1,
        "created_at": "2026-01-01", "updated_at": "2026-01-02", "hrr_vector": b"junk",
    }


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {"host": "127.0.0.1", "port": 3131}}}}),
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
    try:
        yield f"http://{host}:{port}"
    finally:
        await runner.cleanup()
        config_reader.reload()


def _touch_store() -> None:
    from server.lib.upstream_paths import memory_store_path
    memory_store_path(None).write_text("", encoding="utf-8")


@pytest.mark.asyncio
async def test_unavailable_when_holographic_absent(app_server):
    with patch.object(shim.memory, "MemoryStore", None):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/memory") as r:
                assert r.status == 200
                assert await r.json() == {"available": False, "facts": []}


@pytest.mark.asyncio
async def test_available_empty_when_no_db(app_server):
    # holographic present, but no memory_store.db yet → available, no facts,
    # and the store is NOT opened (no empty-db side effect).
    with patch.object(shim.memory, "MemoryStore", _FakeStore):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/memory") as r:
                assert await r.json() == {"available": True, "facts": []}


@pytest.mark.asyncio
async def test_lists_facts_whitelisted(app_server):
    _FakeStore.facts = [_fact(1, "User prefers dark mode"), _fact(2, "Project uses pnpm")]
    _touch_store()
    with patch.object(shim.memory, "MemoryStore", _FakeStore):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/memory") as r:
                data = await r.json()
    assert data["available"] is True
    assert [f["content"] for f in data["facts"]] == ["User prefers dark mode", "Project uses pnpm"]
    assert "hrr_vector" not in data["facts"][0]  # BLOB dropped
    assert data["facts"][0]["category"] == "general"


@pytest.mark.asyncio
async def test_delete_removes_fact(app_server):
    _FakeStore.facts = [_fact(1, "a"), _fact(2, "b")]
    _touch_store()
    with patch.object(shim.memory, "MemoryStore", _FakeStore):
        async with aiohttp.ClientSession() as cs:
            async with cs.delete(f"{app_server}/api/memory/1", headers={"X-HMS-CSRF": "1"}) as r:
                assert r.status == 200
                assert (await r.json())["removed"] is True
    assert [f["fact_id"] for f in _FakeStore.facts] == [2]


@pytest.mark.asyncio
async def test_delete_invalid_id(app_server):
    with patch.object(shim.memory, "MemoryStore", _FakeStore):
        async with aiohttp.ClientSession() as cs:
            async with cs.delete(f"{app_server}/api/memory/nope", headers={"X-HMS-CSRF": "1"}) as r:
                assert r.status == 400
                assert (await r.json())["error"] == "invalid_fact_id"


@pytest.mark.asyncio
async def test_delete_requires_csrf(app_server):
    with patch.object(shim.memory, "MemoryStore", _FakeStore):
        async with aiohttp.ClientSession() as cs:
            async with cs.delete(f"{app_server}/api/memory/1") as r:
                assert r.status == 403  # csrf_middleware blocks the mutation
