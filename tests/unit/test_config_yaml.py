"""config.yaml endpoint tests."""

from __future__ import annotations

import hashlib
from pathlib import Path

import aiohttp
import pytest
from aiohttp import web
from server.app import build_app

INITIAL_YAML = "gateway:\n  port: 8080\n  name: test-gw\n"


@pytest.fixture
async def app_server(quiet_hms_env, monkeypatch, tmp_path: Path):
    """Boot station with a sample config.yaml already on disk."""
    # Point the dashboard proxy at a port that nothing listens on, so
    # the PUT→upstream leg gets a clean connection-refused → 503.
    monkeypatch.setenv("HERMES_DASHBOARD_URL", "http://127.0.0.1:19999")
    (tmp_path / "config.yaml").write_text(INITIAL_YAML, encoding="utf-8")

    # Minimal station config so the app boots without errors.
    ws_dir = tmp_path / "station"
    ws_dir.mkdir(exist_ok=True)

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
        yield base, tmp_path
    finally:
        await runner.cleanup()
        config_reader.reload()


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


@pytest.mark.asyncio
async def test_get_config_yaml_returns_content_and_sha(app_server) -> None:
    base, tmp_path = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/config/yaml") as r:
            assert r.status == 200
            data = await r.json()

    # The endpoint serves the raw on-disk config.yaml. Upstream's config
    # loader normalises the file during app boot (e.g. injecting a default
    # ``terminal:`` block), so the response reflects the *current* on-disk
    # bytes rather than the pristine INITIAL_YAML — compare against disk.
    on_disk = (tmp_path / "config.yaml").read_text(encoding="utf-8")
    assert data["yaml"] == on_disk
    assert data["sha256"] == _sha256(on_disk)
    # The originally-written content is preserved through normalisation.
    assert "gateway:" in data["yaml"]
    assert "name: test-gw" in data["yaml"]
    assert "mtime" in data
    assert "path" in data


@pytest.mark.asyncio
async def test_get_config_yaml_shape_has_required_fields(app_server) -> None:
    """Response includes all documented fields."""
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/config/yaml") as r:
            assert r.status == 200
            data = await r.json()
    # Every field present.
    assert isinstance(data["yaml"], str)
    assert isinstance(data["sha256"], str)
    assert isinstance(data["mtime"], (int, float))
    assert isinstance(data["path"], str)
    # sha256 is consistent.
    assert data["sha256"] == _sha256(data["yaml"])


@pytest.mark.asyncio
async def test_put_409_on_sha_mismatch(app_server) -> None:
    """PUT with a stale sha256 → 409 Conflict."""
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/config/yaml",
            json={"yaml_text": "new: content\n", "expected_sha256": "wrong_sha"},
            headers={
                "X-HMS-CSRF": "1",
                "Content-Type": "application/json",
            },
        ) as r:
            assert r.status == 409
            data = await r.json()
            assert data["conflict"] is True
            assert "current_sha256" in data


@pytest.mark.asyncio
async def test_put_correct_sha_hits_upstream_proxy(app_server) -> None:
    """PUT with matching sha → proxy to upstream (which is down → 503)."""
    base, _ = app_server
    # Fetch the current sha256 from the server — this ensures we have
    # the digest matching what the server sees, even if hermes_home()
    # patching affects the path.
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/config/yaml") as r:
            assert r.status == 200
            get_data = await r.json()
        current_sha = get_data["sha256"]

        async with cs.put(
            f"{base}/api/config/yaml",
            json={"yaml_text": "updated: true\n", "expected_sha256": current_sha},
            headers={
                "X-HMS-CSRF": "1",
                "Content-Type": "application/json",
            },
        ) as r:
            # 503 because the Dashboard proxy is unreachable in test env.
            assert r.status == 503
            data = await r.json()
            assert data["error"] == "upstream_unreachable"


@pytest.mark.asyncio
async def test_put_missing_yaml_text_returns_400(app_server) -> None:
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/config/yaml",
            json={"expected_sha256": "abc"},
            headers={
                "X-HMS-CSRF": "1",
                "Content-Type": "application/json",
            },
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "yaml_text_required"


@pytest.mark.asyncio
async def test_put_missing_sha_returns_400(app_server) -> None:
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/config/yaml",
            json={"yaml_text": "some: yaml\n"},
            headers={
                "X-HMS-CSRF": "1",
                "Content-Type": "application/json",
            },
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "expected_sha256_required"


@pytest.mark.asyncio
async def test_put_invalid_json_body_returns_400(app_server) -> None:
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/config/yaml",
            data=b"not json at all",
            headers={
                "X-HMS-CSRF": "1",
                "Content-Type": "application/json",
            },
        ) as r:
            assert r.status == 400
