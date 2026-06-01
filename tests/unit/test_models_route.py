"""models route tests (vision-check)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.lib import upstream_shim


@pytest.fixture(autouse=True)
def _reset_shim():
    upstream_shim.shim.reset_for_test()
    yield
    upstream_shim.shim.reset_for_test()


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
async def test_vision_check_missing_model_param(app_server) -> None:
    """No model query param → ok: false, source: missing."""
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/models/vision-check") as r:
            assert r.status == 200
            data = await r.json()
    assert data["ok"] is False
    assert data["source"] == "missing"


@pytest.mark.asyncio
async def test_vision_check_upstream_unavailable(app_server) -> None:
    """When shim.models.get_capabilities is None → ok: false, source: unknown."""
    # Default shim state has get_capabilities == None.
    async with aiohttp.ClientSession() as cs:
        async with cs.get(
            f"{app_server}/api/models/vision-check",
            params={"model": "gpt-4o"},
        ) as r:
            assert r.status == 200
            data = await r.json()
    assert data["ok"] is False
    assert data["source"] == "unknown"
    assert data["model"] == "gpt-4o"


@pytest.mark.asyncio
async def test_vision_check_model_supports_vision(app_server) -> None:
    """Model with supports_vision=True → ok: true."""
    caps = MagicMock()
    caps.supports_vision = True
    fake_fn = MagicMock(return_value=caps)

    upstream_shim.shim.models.get_capabilities = fake_fn  # type: ignore[assignment]

    async with aiohttp.ClientSession() as cs:
        async with cs.get(
            f"{app_server}/api/models/vision-check",
            params={"model": "gpt-4o"},
        ) as r:
            assert r.status == 200
            data = await r.json()
    assert data["ok"] is True
    assert data["model"] == "gpt-4o"
    assert data["source"] == "models.dev"


@pytest.mark.asyncio
async def test_vision_check_model_no_vision(app_server) -> None:
    """Model without vision → ok: false."""
    caps = MagicMock()
    caps.supports_vision = False
    fake_fn = MagicMock(return_value=caps)

    upstream_shim.shim.models.get_capabilities = fake_fn  # type: ignore[assignment]

    async with aiohttp.ClientSession() as cs:
        async with cs.get(
            f"{app_server}/api/models/vision-check",
            params={"model": "gpt-3.5-turbo"},
        ) as r:
            assert r.status == 200
            data = await r.json()
    assert data["ok"] is False
    assert data["model"] == "gpt-3.5-turbo"


@pytest.mark.asyncio
async def test_vision_check_fn_returns_none(app_server) -> None:
    """get_capabilities returns None (unknown model) → ok: false."""
    fake_fn = MagicMock(return_value=None)
    upstream_shim.shim.models.get_capabilities = fake_fn  # type: ignore[assignment]

    async with aiohttp.ClientSession() as cs:
        async with cs.get(
            f"{app_server}/api/models/vision-check",
            params={"model": "unknown-model"},
        ) as r:
            assert r.status == 200
            data = await r.json()
    assert data["ok"] is False
    assert data["source"] == "unknown"
