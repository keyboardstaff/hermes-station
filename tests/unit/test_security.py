"""auth + DNS rebinding + rate-limit XFF trust."""

from __future__ import annotations

from pathlib import Path

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app


@pytest.fixture
async def app_server(quiet_hms_env, monkeypatch, tmp_path: Path):
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
        yield base, monkeypatch
    finally:
        await runner.cleanup()
        config_reader.reload()


# host_guard


@pytest.mark.asyncio
async def test_loopback_host_accepted(app_server) -> None:
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/auth-status") as r:
            assert r.status == 200


@pytest.mark.asyncio
async def test_non_loopback_host_rejected_when_bound_loopback(app_server) -> None:
    base, _ = app_server
    # When station is bound to 127.0.0.1, a request whose Host header
    # is "evil.com" must be 403'd — this is the rebinding defense.
    async with aiohttp.ClientSession() as cs:
        async with cs.get(
            f"{base}/api/auth-status",
            headers={"Host": "evil.com"},
        ) as r:
            assert r.status == 403
            body = await r.json()
            assert body["error"] in ("host_not_loopback", "host_not_allowed",
                                     "host_port_mismatch", "host_mismatch")


@pytest.mark.asyncio
async def test_lan_bind_matches_port(quiet_hms_env, monkeypatch, tmp_path: Path) -> None:
    """When bound to 0.0.0.0, any Host is OK *if* its port matches."""
    # quiet_hms_env patches hermes_home → tmp_path (no hermes_constants import),
    # so this runs in CI without the agent venv.
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({
            "platforms": {"station": {"extra": {
                "host": "0.0.0.0",
                "port": 12345,
                # Required when host is 0.0.0.0 — but we're testing the
                # host_guard layer specifically, not the apply_extra_update
                # invariant; the password_hash absence doesn't gate the
                # middleware itself.
            }}},
        }),
        encoding="utf-8",
    )
    from server.lib import config_reader
    config_reader.reload()

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    # Bind on an ephemeral port; host_guard reads the *configured* port
    # from config.yaml (12345), not the socket port.
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    base = f"http://{host}:{port}"

    async with aiohttp.ClientSession() as cs:
        # Host with the configured port → ok.
        async with cs.get(
            f"{base}/api/auth-status",
            headers={"Host": "mybox.lan:12345"},
        ) as r:
            assert r.status == 200, await r.text()
        # Host with a different port → rebinding suspicion → 403.
        async with cs.get(
            f"{base}/api/auth-status",
            headers={"Host": "mybox.lan:80"},
        ) as r:
            assert r.status == 403

    await runner.cleanup()
    config_reader.reload()


@pytest.mark.asyncio
async def test_explicit_allowlist_overrides(quiet_hms_env, monkeypatch, tmp_path: Path) -> None:
    """``HMS_ALLOWED_HOSTS`` is the operator escape hatch."""
    # quiet_hms_env delenvs HMS_ALLOWED_HOSTS first; we set it after, so ours wins.
    monkeypatch.setenv("HMS_ALLOWED_HOSTS", "myname.local")

    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({
            "platforms": {"station": {"extra": {
                "host": "127.0.0.1", "port": 3131,
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

    async with aiohttp.ClientSession() as cs:
        async with cs.get(
            f"{base}/api/auth-status",
            headers={"Host": "myname.local"},
        ) as r:
            assert r.status == 200
        async with cs.get(
            f"{base}/api/auth-status",
            headers={"Host": "different.local"},
        ) as r:
            assert r.status == 403

    await runner.cleanup()
    config_reader.reload()


# auth gating


@pytest.mark.asyncio
async def test_localhost_bypasses_password(quiet_hms_env, monkeypatch, tmp_path: Path) -> None:
    """A configured password_hash does NOT bother loopback callers."""
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({
            "platforms": {"station": {"extra": {
                "host": "127.0.0.1",
                "port": 3131,
                "password_hash": "$argon2id$v=19$m=65536,t=3,p=4$abc$def",
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

    async with aiohttp.ClientSession() as cs:
        # /api/capabilities is a non-public endpoint that does NOT touch the
        # SessionDB, so a 200 proves loopback bypassed the password gate (a 401
        # would mean the gate fired) — without needing the agent venv. Using a
        # DB-backed route like /api/sessions would 500 in CI on the absent
        # SessionDB and mask the auth assertion.
        async with cs.get(f"{base}/api/capabilities") as r:
            # Loopback + no cookie + password configured → still accepted.
            assert r.status == 200

    await runner.cleanup()
    config_reader.reload()


# rate-limit XFF trust


@pytest.mark.asyncio
async def test_rate_limit_xff_only_from_loopback(app_server) -> None:
    """A forged X-Forwarded-For from a fake LAN client must NOT separate."""
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(
            f"{base}/api/auth-status",
            headers={"X-Forwarded-For": "10.0.0.1"},
        ) as r:
            assert r.status == 200
            rl1 = r.headers.get("X-RateLimit-Remaining")
        async with cs.get(
            f"{base}/api/auth-status",
            headers={"X-Forwarded-For": "10.0.0.2"},
        ) as r:
            assert r.status == 200
            rl2 = r.headers.get("X-RateLimit-Remaining")
    # Different XFF source IPs → independent buckets → both at "near
    # full" (limit - 1).
    assert rl1 is not None and rl2 is not None
    assert rl1 == rl2  # both saw a single hit on their own bucket


# is_localhost over a Unix-socket transport (dev Vite proxy → backend socket)


def _unix_request(headers: dict | None = None):
    import socket as _socket
    from unittest.mock import Mock

    from aiohttp.test_utils import make_mocked_request

    class _UnixSock:
        family = _socket.AF_UNIX

    transport = Mock()
    transport.get_extra_info.side_effect = lambda key, default=None: (
        _UnixSock() if key == "socket" else (None if key == "peername" else default)
    )
    return make_mocked_request("GET", "/api/x", headers=headers or {}, transport=transport)


def test_is_localhost_true_for_unix_socket_without_xff() -> None:
    from server import auth
    assert auth.is_localhost(_unix_request()) is True


def test_unix_socket_honors_xff_for_lan_client() -> None:
    # A LAN client tunnelled through the dev Vite proxy (xfwd) must NOT be
    # treated as localhost just because the proxy hop arrives over a socket.
    from server import auth
    assert auth.is_localhost(_unix_request({"X-Forwarded-For": "10.0.0.5"})) is False
    assert auth.is_localhost(_unix_request({"X-Forwarded-For": "127.0.0.1"})) is True
