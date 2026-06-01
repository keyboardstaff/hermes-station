"""Tests for the dashboard proxy's token-scraping logic and URL mapping."""

from __future__ import annotations

from pathlib import Path

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.routes import dashboard_proxy


def _make_upstream(initial_token: str):
    state = {"token": initial_token, "scrape_count": 0, "api_calls": 0}

    async def index(_request: web.Request) -> web.Response:
        state["scrape_count"] += 1
        body = f'<html><body><script>window.__HERMES_SESSION_TOKEN__="{state["token"]}";</script></body></html>'
        return web.Response(text=body, content_type="text/html")

    async def status(_request: web.Request) -> web.Response:
        return web.json_response({"ok": True})

    async def sessions(request: web.Request) -> web.Response:
        state["api_calls"] += 1
        token = request.headers.get("X-Hermes-Session-Token")
        if token != state["token"]:
            return web.json_response(
                {"error": "unauthorized"}, status=401,
            )
        return web.json_response({"sessions": [{"id": "s1"}]})

    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/api/status", status)
    app.router.add_get("/api/sessions", sessions)
    return app, state


@pytest.fixture
async def upstream_dashboard():
    app, state = _make_upstream(initial_token="tok-A")
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    base = f"http://{host}:{port}"
    try:
        yield base, state
    finally:
        await runner.cleanup()


@pytest.fixture
async def hms_app(quiet_hms_env, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, upstream_dashboard):
    base, state = upstream_dashboard
    monkeypatch.setenv("HERMES_DASHBOARD_URL", base)
    monkeypatch.delenv("HERMES_DASHBOARD_TOKEN", raising=False)
    # Second cache reset so HERMES_DASHBOARD_URL takes effect.
    from server.lib import upstream_paths
    upstream_paths.reset_caches_for_test()
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {
            "host": "127.0.0.1", "port": 3131,
        }}}}),
        encoding="utf-8",
    )
    from server.lib import config_reader
    config_reader.reload()
    dashboard_proxy.reset_for_test()

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    ws_base = f"http://{host}:{port}"
    try:
        yield ws_base, state
    finally:
        await runner.cleanup()
        config_reader.reload()


@pytest.mark.asyncio
async def test_proxy_scrapes_token_and_forwards(hms_app) -> None:
    """First call: scrape index → forward with token."""
    ws_base, state = hms_app
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{ws_base}/api/dashboard/sessions") as r:
            assert r.status == 200
            body = await r.json()
    assert body == {"sessions": [{"id": "s1"}]}
    assert state["scrape_count"] == 1, "should have scraped once"
    assert state["api_calls"] == 1, "should have forwarded the request once"


@pytest.mark.asyncio
async def test_proxy_caches_token_across_calls(hms_app) -> None:
    """Second proxy call should reuse the cached token (no re-scrape)."""
    ws_base, state = hms_app
    async with aiohttp.ClientSession() as cs:
        await cs.get(f"{ws_base}/api/dashboard/sessions")
        await cs.get(f"{ws_base}/api/dashboard/sessions")
    assert state["scrape_count"] == 1, "token should be cached"
    assert state["api_calls"] == 2


@pytest.mark.asyncio
async def test_proxy_invalidates_token_on_401_and_retries(hms_app) -> None:
    """When upstream restarts, our cached token is stale → 401 →."""
    ws_base, state = hms_app
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{ws_base}/api/dashboard/sessions") as r:
            assert r.status == 200
    assert state["scrape_count"] == 1

    # Dashboard restart → rotate token.
    state["token"] = "tok-B"

    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{ws_base}/api/dashboard/sessions") as r:
            # stale token → 401 → invalidate → re-scrape → retry → 200.
            assert r.status == 200
            body = await r.json()
    assert body == {"sessions": [{"id": "s1"}]}
    assert state["scrape_count"] == 2


@pytest.mark.asyncio
async def test_proxy_503_when_upstream_unreachable(
    quiet_hms_env, monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    """No upstream → proxy returns 503 dashboard_unavailable."""
    # Port 1 reliably refuses on macOS.
    monkeypatch.setenv("HERMES_DASHBOARD_URL", "http://127.0.0.1:1")
    from server.lib import config_reader, upstream_paths
    upstream_paths.reset_caches_for_test()
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {
            "host": "127.0.0.1", "port": 3131,
        }}}}),
        encoding="utf-8",
    )
    config_reader.reload()
    dashboard_proxy.reset_for_test()

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    ws_base = f"http://{host}:{port}"
    try:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{ws_base}/api/dashboard/status") as r:
                assert r.status == 503
                body = await r.json()
        assert body["error"] == "dashboard_unavailable"
    finally:
        await runner.cleanup()
        config_reader.reload()


@pytest.mark.asyncio
async def test_config_token_overrides_scrape(
    quiet_hms_env, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, upstream_dashboard,
) -> None:
    """An operator-configured token (env / config.yaml) wins over scrape."""
    base, state = upstream_dashboard
    state["token"] = "real-upstream-token"
    monkeypatch.setenv("HERMES_DASHBOARD_URL", base)
    monkeypatch.setenv("HERMES_DASHBOARD_TOKEN", "real-upstream-token")
    from server.lib import config_reader, upstream_paths
    upstream_paths.reset_caches_for_test()
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {
            "host": "127.0.0.1", "port": 3131,
        }}}}),
        encoding="utf-8",
    )
    config_reader.reload()
    dashboard_proxy.reset_for_test()

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    ws_base = f"http://{host}:{port}"
    try:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{ws_base}/api/dashboard/sessions") as r:
                assert r.status == 200
        # The override path must NOT scrape upstream's index.
        assert state["scrape_count"] == 0
    finally:
        await runner.cleanup()
        config_reader.reload()


# URL-mapping tests
#
# Verify that the proxy correctly routes:
#   • Plain /api/* routes (e.g. /skills) → upstream /api/<suffix>
#   • Dashboard-prefixed routes (/plugins/hub, /agent-plugins/*, etc.)
#     → upstream /api/dashboard/<suffix>  (NOT /api/<suffix>)


def _make_recording_upstream(token: str = "tok-rec"):
    calls: list[str] = []

    async def index(_: web.Request) -> web.Response:
        return web.Response(
            text=f'<script>window.__HERMES_SESSION_TOKEN__="{token}";</script>',
            content_type="text/html",
        )

    async def echo(request: web.Request) -> web.Response:
        got = request.headers.get("X-Hermes-Session-Token", "")
        if got != token:
            return web.json_response({"error": "unauthorized"}, status=401)
        calls.append(request.path)
        return web.json_response({"path": request.path})

    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_route("*", "/api/{tail:.*}", echo)
    return app, calls


@pytest.fixture
async def recording_upstream():
    app, calls = _make_recording_upstream()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    try:
        yield f"http://{host}:{port}", calls
    finally:
        await runner.cleanup()


@pytest.fixture
async def ws_recording(
    quiet_hms_env,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    recording_upstream,
):
    base, calls = recording_upstream
    monkeypatch.setenv("HERMES_DASHBOARD_URL", base)
    monkeypatch.delenv("HERMES_DASHBOARD_TOKEN", raising=False)
    from server.lib import config_reader, upstream_paths
    upstream_paths.reset_caches_for_test()
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {
            "host": "127.0.0.1", "port": 3131,
        }}}}),
        encoding="utf-8",
    )
    config_reader.reload()
    dashboard_proxy.reset_for_test()

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    ws_base = f"http://{host}:{port}"
    try:
        yield ws_base, calls
    finally:
        await runner.cleanup()
        config_reader.reload()


@pytest.mark.asyncio
async def test_proxy_plain_route_strips_dashboard(ws_recording) -> None:
    """/api/dashboard/skills → upstream /api/skills (no /dashboard/ prefix)."""
    ws_base, calls = ws_recording
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{ws_base}/api/dashboard/skills") as r:
            assert r.status == 200
            body = await r.json()
    assert body["path"] == "/api/skills", (
        f"Expected /api/skills, got {body['path']!r}"
    )


@pytest.mark.asyncio
async def test_proxy_plugins_hub_preserves_dashboard(ws_recording) -> None:
    """/api/dashboard/plugins/hub → upstream /api/dashboard/plugins/hub."""
    ws_base, calls = ws_recording
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{ws_base}/api/dashboard/plugins/hub") as r:
            assert r.status == 200
            body = await r.json()
    assert body["path"] == "/api/dashboard/plugins/hub", (
        f"Expected /api/dashboard/plugins/hub, got {body['path']!r}"
    )


@pytest.mark.asyncio
async def test_proxy_agent_plugins_preserves_dashboard(ws_recording) -> None:
    """/api/dashboard/agent-plugins/install → upstream /api/dashboard/agent-plugins/install."""
    ws_base, calls = ws_recording
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{ws_base}/api/dashboard/agent-plugins/install",
            json={"identifier": "test-skill"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 200
            body = await r.json()
    assert body["path"] == "/api/dashboard/agent-plugins/install", (
        f"Expected /api/dashboard/agent-plugins/install, got {body['path']!r}"
    )


@pytest.mark.asyncio
async def test_proxy_themes_preserves_dashboard(ws_recording) -> None:
    """/api/dashboard/themes → upstream /api/dashboard/themes."""
    ws_base, calls = ws_recording
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{ws_base}/api/dashboard/themes") as r:
            assert r.status == 200
            body = await r.json()
    assert body["path"] == "/api/dashboard/themes", (
        f"Expected /api/dashboard/themes, got {body['path']!r}"
    )
