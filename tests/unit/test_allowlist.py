"""``server/routes/allowlist.py`` — command-allowlist REST endpoints."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.lib.upstream_shim import shim


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


def _install_shim(initial: set[str] | None = None, *, save_raises=False, load_raises=False):
    state: set[str] = set(initial or ())

    def _load():
        if load_raises:
            raise RuntimeError("load failed")
        return set(state)

    def _save(new: set[str]):
        if save_raises:
            raise RuntimeError("save failed")
        state.clear()
        state.update(new)

    return patch.multiple(
        shim.approval,
        load_allowlist=MagicMock(side_effect=_load),
        save_allowlist=MagicMock(side_effect=_save),
        load_permanent=MagicMock(),
    ), state


@pytest.mark.asyncio
async def test_get_returns_sorted_patterns(app_server):
    patcher, _state = _install_shim({"sudo", "rm_rf", "dd_disk"})
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/allowlist") as r:
                assert r.status == 200
                data = await r.json()

    assert data == {"patterns": ["dd_disk", "rm_rf", "sudo"]}


@pytest.mark.asyncio
async def test_get_empty_list(app_server):
    patcher, _state = _install_shim(set())
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/allowlist") as r:
                data = await r.json()
    assert data == {"patterns": []}


@pytest.mark.asyncio
async def test_get_load_failure_returns_500(app_server):
    patcher, _state = _install_shim(set(), load_raises=True)
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/allowlist") as r:
                assert r.status == 500
                data = await r.json()
                assert data["error"] == "internal_error"


@pytest.mark.asyncio
async def test_post_adds_new_pattern(app_server):
    patcher, state = _install_shim({"sudo"})
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/allowlist",
                json={"pattern_key": "rm_rf"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 201
                data = await r.json()

    assert data["ok"] is True
    assert data["added"] is True
    assert "rm_rf" in data["patterns"]
    assert state == {"sudo", "rm_rf"}


@pytest.mark.asyncio
async def test_post_idempotent_when_already_present(app_server):
    """Re-adding an existing key returns 200 with ``added=false`` — no save."""
    patcher, _state = _install_shim({"sudo"})
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/allowlist",
                json={"pattern_key": "sudo"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

        assert data["added"] is False
        assert data["patterns"] == ["sudo"]
        # ``patch.multiple`` restores the original attribute on exit;
        # assert WHILE the patch is still active.
        shim.approval.save_allowlist.assert_not_called()


@pytest.mark.asyncio
async def test_post_invalid_json_body(app_server):
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/allowlist",
            data=b"not json",
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "invalid_json"


@pytest.mark.asyncio
async def test_post_body_must_be_object(app_server):
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/allowlist",
            json=["not", "a", "dict"],
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "body_must_be_object"


@pytest.mark.parametrize("bad_key", [
    "",                # empty
    "RmRf",            # mixed case
    "1rm",             # starts with digit
    "rm rf",           # space
    "../../etc/passwd", # path traversal-shaped
    "a" * 65,          # too long
])
@pytest.mark.asyncio
async def test_post_rejects_invalid_pattern_key(app_server, bad_key):
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/allowlist",
            json={"pattern_key": bad_key},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400, f"expected 400 for {bad_key!r}"
            data = await r.json()
            assert data["error"] == "invalid_pattern_key"


@pytest.mark.asyncio
async def test_post_save_failure_returns_500(app_server):
    patcher, _state = _install_shim({"sudo"}, save_raises=True)
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/allowlist",
                json={"pattern_key": "rm_rf"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 500
                data = await r.json()
                assert data["error"] == "internal_error"


@pytest.mark.asyncio
async def test_delete_removes_present_pattern(app_server):
    patcher, state = _install_shim({"sudo", "rm_rf"})
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.delete(
                f"{app_server}/api/allowlist/sudo",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["removed"] is True
    assert data["patterns"] == ["rm_rf"]
    assert state == {"rm_rf"}


@pytest.mark.asyncio
async def test_delete_idempotent_when_missing(app_server):
    """Removing a key not in the list returns ``removed=false`` — no save."""
    patcher, _state = _install_shim({"sudo"})
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.delete(
                f"{app_server}/api/allowlist/never_added",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 200
                data = await r.json()

        assert data["removed"] is False
        shim.approval.save_allowlist.assert_not_called()


@pytest.mark.asyncio
async def test_delete_rejects_invalid_pattern_key(app_server):
    """Even though the URL is parsed, the regex still validates."""
    async with aiohttp.ClientSession() as cs:
        async with cs.delete(
            f"{app_server}/api/allowlist/Has%20Space",
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "invalid_pattern_key"
