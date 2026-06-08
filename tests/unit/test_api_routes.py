"""Route smoke tests."""

from __future__ import annotations

from pathlib import Path

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app


@pytest.fixture
async def app_server(quiet_hms_env, monkeypatch, tmp_path: Path):
    """Boot the app against a tmp HERMES_HOME so we never touch real config."""
    # Seed a minimal config.yaml so settings_mod has something to read.
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({
            "platforms": {"station": {"extra": {
                "host": "127.0.0.1",
                "port": 3131,
                "session_ttl_seconds": 86400,
            }}},
            "model": {"default": "test:dummy"},
            "personalities": {"alpha": "p1", "beta": "p2"},
        }),
        encoding="utf-8",
    )
    # Ensure config_reader picks the fresh file up.
    from server.lib import config_reader
    config_reader.reload()

    # Memory is now profile-scoped: point the profiles shim at tmp_path so
    # ``/api/profiles/{name}/memory/{tab}`` resolves under the seeded dirs
    # below (memory file lives at ``<profile_dir>/memories/MEMORY.md``).
    from server.lib import upstream_shim
    upstream_shim.shim.reset_for_test()
    monkeypatch.setattr(
        upstream_shim.shim.profiles,
        "get_profile_dir",
        lambda name: tmp_path,
    )

    # Memory dirs.
    # exist_ok=True: hermes_cli.config.ensure_hermes_home() creates these
    # as a side-effect during upstream module import (triggered by
    # upstream_paths.reset_caches_for_test() → capabilities → upstream_shim).
    (tmp_path / "memories").mkdir(exist_ok=True)
    (tmp_path / "memories" / "MEMORY.md").write_text("# memory", encoding="utf-8")
    (tmp_path / "hermes-agent").mkdir(exist_ok=True)
    (tmp_path / "hermes-agent" / "AGENTS.md").write_text("# agents", encoding="utf-8")
    # Log file.
    (tmp_path / "logs").mkdir(exist_ok=True)
    (tmp_path / "logs" / "agent.log").write_text("line 1\nline 2\nline 3\n", encoding="utf-8")

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
        upstream_shim.shim.reset_for_test()


# settings


@pytest.mark.asyncio
async def test_get_settings_strips_password_hash(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/settings") as r:
            assert r.status == 200
            data = await r.json()
    assert "password_hash" not in data
    assert data.get("password_set") is False
    assert data.get("port") == 3131


@pytest.mark.asyncio
async def test_put_settings_rejects_unknown_key(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{app_server}/api/settings",
            json={"hermes_home": "/wat"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400
            body = await r.json()
            assert body["error"].startswith("unknown_key")


@pytest.mark.asyncio
async def test_put_settings_refuses_password_hash(app_server) -> None:
    """A buggy form must not be able to write a raw string into password_hash."""
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{app_server}/api/settings",
            json={"password_hash": "raw-plain-text"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400
            body = await r.json()
            assert body["error"] == "use_password_endpoint"


@pytest.mark.asyncio
async def test_patch_settings_updates_session_ttl(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.patch(
            f"{app_server}/api/settings",
            json={"session_ttl_seconds": 7200},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 200
            body = await r.json()
            assert body["written"]["session_ttl_seconds"] == 7200
        async with cs.get(f"{app_server}/api/settings") as r:
            data = await r.json()
    assert data["session_ttl_seconds"] == 7200


# password


@pytest.mark.asyncio
async def test_password_initial_set_no_current_required(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/password",
            json={"new": "hunter22"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 200
            body = await r.json()
            assert body["ok"] is True
        # Now password_set should be true via /api/settings.
        async with cs.get(f"{app_server}/api/settings") as r:
            data = await r.json()
            assert data["password_set"] is True


@pytest.mark.asyncio
async def test_password_min_length(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/password",
            json={"new": "abc"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400
            body = await r.json()
            assert "invalid_value" in body["error"]


@pytest.mark.asyncio
async def test_password_wrong_current_rejected(app_server) -> None:
    # First set a password.
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/password",
            json={"new": "hunter22"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 200
        # Try to rotate with a wrong current.
        async with cs.post(
            f"{app_server}/api/password",
            json={"current": "wrong", "new": "hunter33"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 403
            body = await r.json()
            assert body["error"] == "wrong_current"


# config + models


@pytest.mark.asyncio
async def test_get_config_surfaces_personalities_and_model_default(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/config") as r:
            assert r.status == 200
            data = await r.json()
    assert data["model_default"] == "test:dummy"
    assert data["personalities"] == ["alpha", "beta"]


@pytest.mark.asyncio
async def test_get_models_returns_expected_shape(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/models") as r:
            assert r.status == 200
            data = await r.json()
    assert "models" in data
    assert "model_default" in data
    assert "providers" in data
    assert isinstance(data["models"], list)
    assert isinstance(data["providers"], list)


@pytest.mark.asyncio
async def test_get_models_invalid_profile_rejected(app_server) -> None:
    """A malformed ?profile= is a 400 before any provider probe."""
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/models?profile=Bad!Name") as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "invalid_profile"


@pytest.mark.asyncio
async def test_get_models_well_formed_profile_ok(app_server) -> None:
    """A well-formed but unknown ?profile= no-ops back to the process home."""
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/models?profile=work") as r:
            assert r.status == 200
            data = await r.json()
    assert "providers" in data
    assert isinstance(data["providers"], list)


# memory (profile-scoped: /api/profiles/{name}/memory/{tab})


@pytest.mark.asyncio
async def test_memory_get_unknown_tab_400(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/profiles/default/memory/etc") as r:
            assert r.status == 400


@pytest.mark.asyncio
async def test_memory_read_existing(app_server) -> None:
    # The fixture seeds <profile_dir>/memories/MEMORY.md with "# memory".
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/profiles/default/memory/memory") as r:
            assert r.status == 200
            data = await r.json()
    assert data["content"] == "# memory"


@pytest.mark.asyncio
async def test_memory_put_and_reread(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{app_server}/api/profiles/default/memory/memory",
            json={"content": "# updated\n"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 200
        async with cs.get(f"{app_server}/api/profiles/default/memory/memory") as r:
            data = await r.json()
    assert data["content"] == "# updated\n"


@pytest.mark.asyncio
async def test_memory_put_too_large_413(app_server) -> None:
    huge = "x" * (5 * 1024 * 1024 + 1)
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{app_server}/api/profiles/default/memory/user",
            json={"content": huge},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            # aiohttp may reject the body at client_max_size first → 413
            # either way; we just need to confirm "not a 200".
            assert r.status in (413, 400)


# logs


@pytest.mark.asyncio
async def test_logs_tail_one_shot(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/fs/logs/agent?tail=2") as r:
            assert r.status == 200
            data = await r.json()
    # Last two lines of the seeded file.
    assert data["lines"] == ["line 2", "line 3"]


@pytest.mark.asyncio
async def test_logs_unknown_file_400(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/fs/logs/secrets?tail=5") as r:
            assert r.status == 400
