"""dynamic discovery endpoints."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import patch

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.lib import upstream_shim
from server.routes import plugins as discover_mod


@pytest.fixture(autouse=True)
def _reset_shim_between_tests() -> None:
    upstream_shim.shim.reset_for_test()
    yield
    upstream_shim.shim.reset_for_test()


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    """Minimal app boot — no real config; just enough for the routes to mount."""
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


def test_platforms_payload_returns_count_and_list() -> None:
    payload = discover_mod._build_platforms_payload()
    assert "platforms" in payload
    assert "count" in payload
    assert isinstance(payload["platforms"], list)
    assert payload["count"] == len(payload["platforms"])


def test_slash_commands_sourced_from_upstream_registry() -> None:
    """Endpoint returns the upstream COMMAND_REGISTRY filtered for gateway use.

    ``/handoff`` is upstream-cli-only — it's the CLI's escape hatch to a
    messaging platform — so station (already a gateway client) hides it.
    """
    pytest.importorskip(
        "hermes_cli.commands",
        reason="asserts on the real upstream COMMAND_REGISTRY; runs only with hermes-agent",
    )
    payload = discover_mod._build_slash_commands_payload()
    names = {c["name"] for c in payload["commands"]}
    # Staples that exist for both CLI and gateway.
    assert {"help", "model", "platform", "subgoal"}.issubset(names)
    # cli_only without a gateway gate is filtered.
    assert "handoff" not in names


def test_slash_commands_marks_source_field() -> None:
    payload = discover_mod._build_slash_commands_payload()
    for cmd in payload["commands"]:
        assert cmd["source"] in ("builtin", "plugin")
        assert isinstance(cmd["name"], str) and cmd["name"]


def test_themes_payload_returns_list_even_when_upstream_absent() -> None:
    payload = discover_mod._build_themes_payload()
    assert isinstance(payload["themes"], list)
    assert payload["count"] == len(payload["themes"])


def test_platforms_dedup_by_name() -> None:
    # Stub the underlying shim accessors.
    class FakePlatform:
        def __init__(self, v: str): self.value = v; self.name = v.upper()
    def fake_enum():
        return iter([FakePlatform("station"), FakePlatform("telegram")])

    class _EnumProxy:
        def __iter__(self): return fake_enum()
    fake_registry = lambda: [
        {"name": "telegram", "label": "Telegram (plugin)", "kind": "plugin"},
    ]
    upstream_shim.shim.platforms.enum = _EnumProxy()  # type: ignore[assignment]
    upstream_shim.shim.platforms.registry = fake_registry  # type: ignore[assignment]

    payload = discover_mod._build_platforms_payload()
    names = [p["name"] for p in payload["platforms"]]
    # Telegram should appear once (plugin wins via last-write).
    assert names.count("telegram") == 1
    # And both names are present.
    assert set(names) == {"station", "telegram"}


@pytest.mark.asyncio
async def test_http_platforms_returns_documented_shape(app_server) -> None:
    """``GET /api/discover/platforms`` returns ``{platforms, count}``."""
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/discover/platforms") as r:
            assert r.status == 200
            data = await r.json()
    assert "platforms" in data
    assert isinstance(data["platforms"], list)
    assert data["count"] == len(data["platforms"])


@pytest.mark.asyncio
async def test_http_slash_commands_returns_registry(app_server) -> None:
    """Endpoint serves the upstream COMMAND_REGISTRY, gateway-filtered."""
    pytest.importorskip(
        "hermes_cli.commands",
        reason="asserts on the real upstream COMMAND_REGISTRY; runs only with hermes-agent",
    )
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/discover/slash-commands") as r:
            assert r.status == 200
            data = await r.json()
    names = {c["name"] for c in data["commands"]}
    assert {"help", "model", "platform", "subgoal"}.issubset(names)


@pytest.mark.asyncio
async def test_http_themes_returns_list_shape(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/discover/themes") as r:
            assert r.status == 200
            data = await r.json()
    assert isinstance(data["themes"], list)
    assert data["count"] == len(data["themes"])


def test_payload_hash_is_stable_across_dict_iteration_order() -> None:
    a = {"platforms": [{"name": "x", "label": "X", "kind": "builtin"}], "count": 1}
    b = {"count": 1, "platforms": [{"label": "X", "name": "x", "kind": "builtin"}]}
    assert discover_mod._payload_hash(a) == discover_mod._payload_hash(b)


def test_payload_hash_changes_on_real_diff() -> None:
    a = {"platforms": [{"name": "x"}], "count": 1}
    b = {"platforms": [{"name": "y"}], "count": 1}
    assert discover_mod._payload_hash(a) != discover_mod._payload_hash(b)


@pytest.mark.asyncio
async def test_watcher_broadcasts_on_change() -> None:
    """When a builder's output changes, the watcher pushes a frame."""
    broadcasts: list[tuple[str, dict]] = []

    class FakeWS:
        async def broadcast(self, channel: str, payload: dict) -> None:
            broadcasts.append((channel, payload))

    fake_ws = FakeWS()
    # Toggle the platforms builder between two outputs so the second
    # iteration looks like a change. First iteration seeds, second
    # broadcasts.
    state = {"flip": False}

    def fake_builder() -> dict:
        state["flip"] = not state["flip"]
        return {"platforms": [{"name": "a" if state["flip"] else "b"}], "count": 1}

    with patch.dict(discover_mod._BUILDERS, {"platforms": fake_builder}, clear=False), \
         patch("server.routes.plugins._WATCHER_INTERVAL_S", 0.01), \
         patch("server.ws.get_ws_manager", return_value=fake_ws):
        task = asyncio.create_task(discover_mod._watcher_loop())
        await asyncio.sleep(0.05)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    # At least one broadcast for the toggled resource.
    matching = [b for b in broadcasts if b[1].get("resource") == "platforms"]
    assert len(matching) >= 1
    assert matching[0][0] == discover_mod.DISCOVERY_CHANNEL
    assert matching[0][1]["type"] == "discovery.changed"
