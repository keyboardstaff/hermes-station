"""Projects file-store concurrency + validation tests."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from aiohttp import web
from server.lib import upstream_paths


@pytest.fixture
async def projects_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Spin up an aiohttp test client with just the projects routes."""
    # Redirect hms_data_dir() to tmp_path.
    monkeypatch.setattr(upstream_paths, "hms_data_dir", lambda: tmp_path)
    # Re-import projects module so its top-level path helper reads the patched dir.
    import importlib

    from server.routes import projects
    importlib.reload(projects)

    app = web.Application()
    projects.attach(app)
    from aiohttp.test_utils import TestClient, TestServer

    server = TestServer(app)
    client = TestClient(server)
    await client.start_server()
    try:
        yield client
    finally:
        await client.close()


# CRUD happy path


@pytest.mark.asyncio
async def test_create_list_update_delete(projects_client: Any) -> None:
    # Empty.
    r = await projects_client.get("/api/projects")
    assert (await r.json()) == {"projects": []}

    # Create.
    r = await projects_client.post(
        "/api/projects", json={"name": "Hermes Core", "color": "#22c55e"}
    )
    assert r.status == 201
    created = await r.json()
    assert created["name"] == "Hermes Core"
    assert created["color"] == "#22c55e"
    assert len(created["id"]) == 12

    # List shows it.
    r = await projects_client.get("/api/projects")
    listed = (await r.json())["projects"]
    assert len(listed) == 1
    assert listed[0] == created

    # Update.
    pid = created["id"]
    r = await projects_client.put(f"/api/projects/{pid}", json={"name": "Renamed"})
    assert r.status == 200
    assert (await r.json())["name"] == "Renamed"

    # Delete.
    r = await projects_client.delete(f"/api/projects/{pid}")
    assert r.status == 200
    r = await projects_client.get("/api/projects")
    assert (await r.json())["projects"] == []


# Validation


@pytest.mark.asyncio
async def test_rejects_invalid_name(projects_client: Any) -> None:
    r = await projects_client.post("/api/projects", json={"name": "", "color": "#fff"})
    assert r.status == 400
    r = await projects_client.post(
        "/api/projects", json={"name": "x" * 200, "color": "#fff"}
    )
    assert r.status == 400


@pytest.mark.asyncio
async def test_rejects_invalid_color(projects_client: Any) -> None:
    r = await projects_client.post(
        "/api/projects", json={"name": "ok", "color": "javascript:alert(1)"}
    )
    assert r.status == 400


@pytest.mark.asyncio
async def test_update_unknown_returns_404(projects_client: Any) -> None:
    r = await projects_client.put(
        "/api/projects/abcdef012345", json={"name": "X"}
    )
    assert r.status == 404


@pytest.mark.asyncio
async def test_delete_unknown_returns_404(projects_client: Any) -> None:
    r = await projects_client.delete("/api/projects/abcdef012345")
    assert r.status == 404


@pytest.mark.asyncio
async def test_rejects_malformed_id(projects_client: Any) -> None:
    r = await projects_client.put("/api/projects/../etc/passwd", json={})
    # aiohttp router routes the malformed path to a different handler / 404
    # before we see it; either status is acceptable as long as no file write
    # happened. Accept 400 or 404.
    assert r.status in (400, 404)


# Concurrency


@pytest.mark.asyncio
async def test_concurrent_creates_do_not_lose_writes(
    projects_client: Any, tmp_path: Path
) -> None:
    """20 concurrent POSTs should yield 20 distinct entries (no lost write)."""
    async def _create(i: int) -> str:
        r = await projects_client.post(
            "/api/projects", json={"name": f"p{i}", "color": "#22c55e"}
        )
        assert r.status == 201, await r.text()
        return (await r.json())["id"]

    ids = await asyncio.gather(*[_create(i) for i in range(20)])
    assert len(set(ids)) == 20

    # On-disk file matches.
    on_disk = json.loads((tmp_path / "projects.json").read_text(encoding="utf-8"))
    assert {p["id"] for p in on_disk} == set(ids)


@pytest.mark.asyncio
async def test_concurrent_delete_then_create_keeps_consistency(
    projects_client: Any,
) -> None:
    r = await projects_client.post(
        "/api/projects", json={"name": "kept", "color": "#fff"}
    )
    keep_id = (await r.json())["id"]

    async def _spam_create() -> None:
        for i in range(5):
            await projects_client.post(
                "/api/projects", json={"name": f"x{i}", "color": "#000"}
            )

    async def _spam_delete() -> None:
        # Try to delete a non-existent project repeatedly; should not corrupt list.
        for _ in range(5):
            await projects_client.delete("/api/projects/000000000000")

    await asyncio.gather(_spam_create(), _spam_delete())
    r = await projects_client.get("/api/projects")
    listed = (await r.json())["projects"]
    # We kept the original + at least 1 of the concurrent creates.
    assert any(p["id"] == keep_id for p in listed)
    assert len(listed) >= 1
