"""``server/routes/mcp.py`` — configured MCP server management.

Covers list / add (stdio + http) / toggle enabled / remove, against the active
profile's ``config.yaml`` ``mcp_servers`` block. Mocks ``shim.mcp.installed_servers``
for the list view; mutations write the real temp config.yaml.
"""

from __future__ import annotations

from pathlib import Path

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app

_CSRF = {"X-HMS-CSRF": "1", "Content-Type": "application/json"}


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    cfg_path = tmp_path / "config.yaml"
    cfg_path.write_text(
        yaml.safe_dump({
            "platforms": {"station": {"extra": {"host": "127.0.0.1", "port": 3131}}},
            "mcp_servers": {
                "linear": {"url": "https://mcp.linear.app/sse", "auth": "oauth", "enabled": True},
                "local": {"command": "uvx", "args": ["some-mcp"], "enabled": False},
            },
        }),
        encoding="utf-8",
    )
    from server.lib import config_reader
    config_reader.reload()

    from server.lib import upstream_shim
    upstream_shim.shim.reset_for_test()
    # installed_servers() reads the live config; back it with our temp file.
    upstream_shim.shim.mcp.installed_servers = lambda: (
        yaml.safe_load(cfg_path.read_text(encoding="utf-8")).get("mcp_servers") or {}
    )

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    try:
        yield f"http://{host}:{port}", cfg_path
    finally:
        await runner.cleanup()
        config_reader.reload()
        upstream_shim.shim.reset_for_test()


@pytest.mark.asyncio
async def test_list_servers(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/mcp/servers") as r:
            assert r.status == 200
            data = await r.json()
    names = {s["name"] for s in data["servers"]}
    assert names == {"linear", "local"}
    linear = next(s for s in data["servers"] if s["name"] == "linear")
    assert linear["transport"] == "http"
    assert linear["url"].endswith("/sse")
    assert linear["enabled"] is True
    local = next(s for s in data["servers"] if s["name"] == "local")
    assert local["transport"] == "stdio"
    assert local["args"] == ["some-mcp"]
    assert local["enabled"] is False


@pytest.mark.asyncio
async def test_add_stdio_server(app_server):
    base, cfg_path = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{base}/api/mcp/servers",
            json={"name": "fs", "transport": "stdio", "command": "npx", "args": ["@mcp/fs"]},
            headers=_CSRF,
        ) as r:
            assert r.status == 201, await r.text()
    doc = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    assert doc["mcp_servers"]["fs"] == {"enabled": True, "command": "npx", "args": ["@mcp/fs"]}


@pytest.mark.asyncio
async def test_add_http_server(app_server):
    base, cfg_path = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{base}/api/mcp/servers",
            json={"name": "remote", "transport": "http", "url": "https://x.example/mcp", "auth": "oauth"},
            headers=_CSRF,
        ) as r:
            assert r.status == 201, await r.text()
    entry = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))["mcp_servers"]["remote"]
    assert entry == {"enabled": True, "url": "https://x.example/mcp", "auth": "oauth"}


@pytest.mark.asyncio
async def test_add_duplicate_conflicts(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{base}/api/mcp/servers",
            json={"name": "linear", "transport": "http", "url": "https://x"},
            headers=_CSRF,
        ) as r:
            assert r.status == 409
            assert (await r.json())["error"] == "already_exists"


@pytest.mark.asyncio
async def test_add_invalid_transport(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{base}/api/mcp/servers",
            json={"name": "bad", "transport": "carrier-pigeon"},
            headers=_CSRF,
        ) as r:
            assert r.status == 400
            assert (await r.json())["error"] == "invalid_transport"


@pytest.mark.asyncio
async def test_toggle_enabled_preserves_comments(app_server):
    base, cfg_path = app_server
    # Seed a comment to prove the scalar write keeps it.
    raw = cfg_path.read_text(encoding="utf-8")
    cfg_path.write_text("# keep me\n" + raw, encoding="utf-8")
    async with aiohttp.ClientSession() as cs:
        async with cs.patch(
            f"{base}/api/mcp/servers/local",
            json={"enabled": True},
            headers=_CSRF,
        ) as r:
            assert r.status == 200, await r.text()
    text = cfg_path.read_text(encoding="utf-8")
    assert "# keep me" in text
    assert yaml.safe_load(text)["mcp_servers"]["local"]["enabled"] is True


@pytest.mark.asyncio
async def test_toggle_missing_404(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.patch(
            f"{base}/api/mcp/servers/ghost",
            json={"enabled": False},
            headers=_CSRF,
        ) as r:
            assert r.status == 404


@pytest.mark.asyncio
async def test_remove_server(app_server):
    base, cfg_path = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.delete(f"{base}/api/mcp/servers/linear", headers=_CSRF) as r:
            assert r.status == 200, await r.text()
    assert "linear" not in yaml.safe_load(cfg_path.read_text(encoding="utf-8"))["mcp_servers"]
