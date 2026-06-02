"""Tests for the PR-3 lifecycle route surface."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({
            "platforms": {"station": {"extra": {
                "host": "127.0.0.1",
                "port": 3131,
            }}},
        }),
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


# status payload


@pytest.mark.asyncio
async def test_status_includes_dashboard_section_even_without_supervisor(app_server) -> None:
    base = app_server
    # Dashboard autostart was disabled in the fixture, so no supervisor
    # is attached. Status must still return a sensible dashboard block.
    with patch("server.lifecycle.get_plugin_status") as plugin_stub, \
         patch("server.lifecycle.get_gateway_status", return_value={
             "manager": "launchd", "service_installed": True,
             "service_running": True, "gateway_pids": [1234],
             "live_pids": [1234], "service_scope": "user",
         }):
        plugin_stub.return_value.plugin_dir = Path("/tmp/repo")
        plugin_stub.return_value.plugin_link_dir = Path("/tmp/link")
        plugin_stub.return_value.files_installed = True
        plugin_stub.return_value.config_enabled = True
        plugin_stub.return_value.config_present = True

        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{base}/api/lifecycle/status") as r:
                assert r.status == 200
                body = await r.json()

    # Three top-level sections + platform.
    assert set(body.keys()) >= {"plugin", "dashboard", "gateway", "platform"}
    assert body["dashboard"]["state"] == "unmanaged"
    assert body["dashboard"]["managed_by_hms"] is False
    assert body["dashboard"]["url"].startswith("http://")
    # Gateway block preserved from upstream snapshot.
    assert body["gateway"]["service_running"] is True


@pytest.mark.asyncio
async def test_status_includes_supervisor_snapshot_when_attached(app_server, monkeypatch) -> None:
    """When a supervisor IS attached, its snapshot is returned verbatim."""
    base = app_server

    # Build a fake supervisor and stuff it on the running app. The
    # easiest way is to grab the app reference back through the running
    # site — aiohttp exposes it via runner.app.
    class FakeSupervisor:
        def snapshot(self):
            return {
                "state": "running",
                "pid": 4242,
                "managed_by_hms": True,
                "url": "http://127.0.0.1:9119",
                "started_at": 1000.0,
                "last_error": None,
                "recent_crashes": [],
            }

    # The app instance is reachable via the URL — we hit it indirectly
    # through a request hook. Simpler: monkeypatch the snapshot helper.
    from server.routes import lifecycle as lifecycle_route

    monkeypatch.setattr(
        lifecycle_route, "_dashboard_snapshot",
        lambda req: FakeSupervisor().snapshot(),
    )
    with patch("server.lifecycle.get_plugin_status") as plugin_stub, \
         patch("server.lifecycle.get_gateway_status", return_value={}):
        plugin_stub.return_value.plugin_dir = Path("/tmp/repo")
        plugin_stub.return_value.plugin_link_dir = Path("/tmp/link")
        plugin_stub.return_value.files_installed = True
        plugin_stub.return_value.config_enabled = True
        plugin_stub.return_value.config_present = True

        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{base}/api/lifecycle/status") as r:
                body = await r.json()
    assert body["dashboard"]["state"] == "running"
    assert body["dashboard"]["pid"] == 4242
    assert body["dashboard"]["managed_by_hms"] is True


# canonical restart endpoint


@pytest.mark.asyncio
async def test_gateway_restart_uses_sigusr1_when_pid_present(app_server) -> None:
    base = app_server
    with patch("server.lifecycle.request_gateway_self_restart",
               return_value={"ok": True, "reason": "signalled",
                             "pids_signalled": [1234], "pids_found": [1234]}):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{base}/api/lifecycle/gateway/restart",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 202
                body = await r.json()
    assert body["ok"] is True
    assert body["method"] == "sigusr1"


@pytest.mark.asyncio
async def test_gateway_restart_falls_back_to_spawn_when_not_running(app_server) -> None:
    """No PIDs found → spawn ``hermes gateway restart`` detached."""
    base = app_server
    with patch(
        "server.lifecycle.request_gateway_self_restart",
        return_value={"ok": False, "reason": "not_running", "pids": []},
    ), patch(
        "server.lifecycle.spawn_hermes_gateway_restart",
        return_value={"ok": True, "reason": "spawned", "pid": 9999, "log": "/tmp/x.log"},
    ):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{base}/api/lifecycle/gateway/restart",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 202
                body = await r.json()
    assert body["ok"] is True
    assert body["method"] == "spawn"
    assert body["reason"] == "spawned"


@pytest.mark.asyncio
async def test_gateway_restart_spawns_when_pid_not_ancestor(app_server) -> None:
    """PIDs found but ancestry check rejects them (launchd-owned gateway)."""
    base = app_server
    with patch(
        "server.lifecycle.request_gateway_self_restart",
        return_value={"ok": False, "reason": "not_ancestor",
                      "pids_signalled": [], "pids_found": [12345]},
    ), patch(
        "server.lifecycle.spawn_hermes_gateway_restart",
        return_value={"ok": True, "reason": "spawned", "pid": 9999, "log": "/tmp/x.log"},
    ):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{base}/api/lifecycle/gateway/restart",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 202
                body = await r.json()
    assert body["ok"] is True
    assert body["method"] == "spawn"


@pytest.mark.asyncio
async def test_gateway_restart_500_when_spawn_crashes(app_server) -> None:
    """Spawn subprocess failure is a real internal error → 500."""
    base = app_server
    with patch(
        "server.lifecycle.request_gateway_self_restart",
        return_value={"ok": False, "reason": "not_running", "pids": []},
    ), patch(
        "server.lifecycle.spawn_hermes_gateway_restart",
        return_value={"ok": False, "reason": "spawn_failed", "error": "ENOENT"},
    ):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{base}/api/lifecycle/gateway/restart",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 500
                body = await r.json()
    assert body["ok"] is False
    assert body["reason"] == "spawn_failed"


@pytest.mark.asyncio
async def test_gateway_restart_409_when_unclassified_failure(app_server) -> None:
    """Any other SIGUSR1 failure (e.g. unknown upstream reason) → 409,."""
    base = app_server
    with patch(
        "server.lifecycle.request_gateway_self_restart",
        return_value={"ok": False, "reason": "weird_new_state", "pids_found": [1]},
    ):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{base}/api/lifecycle/gateway/restart",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 409
                body = await r.json()
    assert body["ok"] is False
    assert body["reason"] == "weird_new_state"


# restart spawner threads the active profile


def test_restart_spawner_passes_active_profile(quiet_hms_env, monkeypatch) -> None:
    import server.lifecycle as lifecycle

    captured: dict = {}

    class _FakePopen:
        def __init__(self, argv, **kwargs) -> None:
            captured["argv"] = argv
            captured["env"] = kwargs.get("env", {})
            self.pid = 4321

    monkeypatch.setattr("subprocess.Popen", _FakePopen)
    monkeypatch.setattr("server.lib.upstream_paths.hermes_executable", lambda: "hermes")
    monkeypatch.setattr("server.lib.profile_run.active_profile_name", lambda: "creative")

    out = lifecycle.spawn_hermes_gateway_restart()
    assert out["ok"] is True
    # Restart comes up under the active profile, not ~/.hermes.
    assert captured["argv"] == ["hermes", "-p", "creative", "gateway", "restart"]
    # -p wins: no stale HERMES_HOME inherited into the child.
    assert "HERMES_HOME" not in captured["env"]


def test_restart_spawner_default_profile_is_plain(quiet_hms_env, monkeypatch) -> None:
    import server.lifecycle as lifecycle

    captured: dict = {}

    class _FakePopen:
        def __init__(self, argv, **kwargs) -> None:
            captured["argv"] = argv
            self.pid = 1

    monkeypatch.setattr("subprocess.Popen", _FakePopen)
    monkeypatch.setattr("server.lib.upstream_paths.hermes_executable", lambda: "hermes")
    monkeypatch.setattr("server.lib.profile_run.active_profile_name", lambda: None)

    lifecycle.spawn_hermes_gateway_restart()
    assert captured["argv"] == ["hermes", "gateway", "restart"]


# CLI `hms restart` under a non-default profile → `-p` synchronous restart


def test_restart_under_profile_uses_dash_p(quiet_hms_env, monkeypatch) -> None:
    import server.lifecycle as lifecycle

    captured: dict = {}

    class _Completed:
        returncode = 0

    def _fake_run(argv, **kwargs):
        captured["argv"] = argv
        captured["env"] = kwargs.get("env", {})
        return _Completed()

    monkeypatch.setattr("subprocess.run", _fake_run)
    monkeypatch.setattr("server.lib.upstream_paths.hermes_executable", lambda: "hermes")

    out = lifecycle.restart_gateway_under_profile("creative")
    assert out["ok"] is True
    assert captured["argv"] == ["hermes", "-p", "creative", "gateway", "restart"]
    assert "HERMES_HOME" not in captured["env"]


def test_restart_under_profile_reports_failure(quiet_hms_env, monkeypatch) -> None:
    import server.lifecycle as lifecycle

    class _Failed:
        returncode = 3

    monkeypatch.setattr("subprocess.run", lambda argv, **k: _Failed())
    monkeypatch.setattr("server.lib.upstream_paths.hermes_executable", lambda: "hermes")

    out = lifecycle.restart_gateway_under_profile("creative")
    assert out["ok"] is False
    assert out["exit_code"] == 3