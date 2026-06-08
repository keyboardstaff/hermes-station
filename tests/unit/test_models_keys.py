"""models key management + assignment endpoint tests."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.routes import models as models_mod


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    models_mod.reset_rate_limits_for_test()
    yield
    models_mod.reset_rate_limits_for_test()


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


_FAKE_OPTIONAL = {
    "OPENAI_API_KEY": {
        "description": "OpenAI API key",
        "url": "https://platform.openai.com/api-keys",
        "category": "provider",
        "password": True,
        "advanced": False,
    },
    "TELEGRAM_BOT_TOKEN": {
        "description": "Telegram bot token",
        "url": None,
        "category": "messaging",
        "password": True,
        "advanced": False,
    },
}


def _patch_env(*, on_disk=None, optional=None, channel=None):
    """Patch the in-process env shim with a fake ``.env`` + catalog.

    ``optional``/``channel`` default to the OpenAI+Telegram catalog and an
    empty channel-managed set; ``on_disk`` is the fake ``.env`` mapping.
    """
    on_disk = dict(on_disk or {})
    optional = _FAKE_OPTIONAL if optional is None else optional
    channel = frozenset() if channel is None else channel
    env = models_mod.shim.env
    return (
        patch.object(env, "optional_vars", optional),
        patch.object(env, "load_env", lambda: dict(on_disk)),
        patch.object(env, "redact_key", lambda v: f"{v[:4]}******{v[-4:]}"),
        patch.object(env, "channel_managed_keys", lambda: channel),
    )


@pytest.mark.asyncio
async def test_keys_returns_categories(app_server) -> None:
    """GET /api/models/keys joins the catalog with the profile .env in-process."""
    p1, p2, p3, p4 = _patch_env(on_disk={"OPENAI_API_KEY": "sk-proj-secret-xyz1"})
    with p1, p2, p3, p4:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/models/keys") as r:
                assert r.status == 200
                data = await r.json()

    keys = {k["name"]: k for k in data["keys"]}
    assert keys["OPENAI_API_KEY"]["category"] == "provider"
    assert keys["OPENAI_API_KEY"]["set"] is True
    assert keys["OPENAI_API_KEY"]["masked"] == "sk-p******xyz1"
    assert keys["OPENAI_API_KEY"]["description"] == "OpenAI API key"
    assert keys["OPENAI_API_KEY"]["url"] is not None

    assert keys["TELEGRAM_BOT_TOKEN"]["category"] == "messaging"
    assert keys["TELEGRAM_BOT_TOKEN"]["set"] is False
    assert keys["TELEGRAM_BOT_TOKEN"]["masked"] == ""


@pytest.mark.asyncio
async def test_keys_env_unavailable(app_server) -> None:
    """No upstream catalog → graceful empty list + env_unavailable marker."""
    with patch.object(models_mod.shim.env, "optional_vars", None):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/models/keys") as r:
                assert r.status == 200
                data = await r.json()

    assert data["keys"] == []
    assert data["error"] == "env_unavailable"


@pytest.mark.asyncio
async def test_keys_invalid_profile_rejected(app_server) -> None:
    """A malformed ?profile= is a 400 before any env read."""
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/models/keys?profile=Bad!Name") as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "invalid_profile"


@pytest.mark.asyncio
async def test_keys_profile_scopes_override(app_server) -> None:
    """A well-formed ?profile= threads through profile_home_override."""
    seen: list[str | None] = []
    real = models_mod.profile_home_override

    def spy(profile):
        seen.append(profile)
        return real(profile)

    p1, p2, p3, p4 = _patch_env(on_disk={})
    with p1, p2, p3, p4, patch.object(models_mod, "profile_home_override", spy):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/models/keys?profile=work") as r:
                assert r.status == 200
    assert seen == ["work"]


@pytest.mark.asyncio
async def test_reveal_returns_clear_value(app_server) -> None:
    """Reveal reads the selected profile's .env directly and returns the value."""
    with patch.object(
        models_mod.shim.env, "load_env", lambda: {"OPENAI_API_KEY": "sk-proj-real"}
    ):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/models/keys/reveal",
                json={"name": "OPENAI_API_KEY"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["name"] == "OPENAI_API_KEY"
    assert data["value"] == "sk-proj-real"


@pytest.mark.asyncio
async def test_reveal_rate_limited(app_server) -> None:
    """Local rate limit kicks in on the 6th call."""
    with patch.object(models_mod.shim.env, "load_env", lambda: {"KEY": "val"}):
        async with aiohttp.ClientSession() as cs:
            for i in range(5):
                async with cs.post(
                    f"{app_server}/api/models/keys/reveal",
                    json={"name": "KEY"},
                    headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
                ) as r:
                    assert r.status == 200, f"Call {i+1} failed with {r.status}"

            async with cs.post(
                f"{app_server}/api/models/keys/reveal",
                json={"name": "KEY"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 429
                data = await r.json()
                assert data["error"] == "rate_limited"


@pytest.mark.asyncio
async def test_reveal_missing_name_returns_400(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/models/keys/reveal",
            json={},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "name_required"


@pytest.mark.asyncio
async def test_reveal_key_not_set(app_server) -> None:
    """A key absent from the profile .env → 404 key_not_found."""
    with patch.object(models_mod.shim.env, "load_env", lambda: {}):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/models/keys/reveal",
                json={"name": "UNKNOWN_KEY"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 404
                data = await r.json()
                assert data["error"] == "key_not_found"


@pytest.mark.asyncio
async def test_set_key_success(app_server) -> None:
    """PUT /api/models/keys writes via upstream save_env_value, in-process."""
    saved: dict[str, str] = {}

    def fake_save(name, value):
        saved["name"] = name
        saved["value"] = value

    with patch.object(models_mod.shim.env, "save_value", fake_save):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/models/keys",
                json={"name": "OPENAI_API_KEY", "value": "sk-new"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["ok"] is True
    assert data["name"] == "OPENAI_API_KEY"
    assert saved == {"name": "OPENAI_API_KEY", "value": "sk-new"}


@pytest.mark.asyncio
async def test_set_key_invalid_name(app_server) -> None:
    """save_env_value raising ValueError (denylist / bad name) → 400."""
    def boom(name, value):
        raise ValueError("denylisted")

    with patch.object(models_mod.shim.env, "save_value", boom):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/models/keys",
                json={"name": "PATH", "value": "x"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 400
                data = await r.json()
                assert data["error"] == "invalid"


@pytest.mark.asyncio
async def test_set_key_missing_name(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{app_server}/api/models/keys",
            json={"value": "v"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400


@pytest.mark.asyncio
async def test_set_key_env_unavailable(app_server) -> None:
    with patch.object(models_mod.shim.env, "save_value", None):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/models/keys",
                json={"name": "KEY", "value": "v"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 503


@pytest.mark.asyncio
async def test_delete_key_success(app_server) -> None:
    removed: dict[str, str] = {}

    def fake_remove(name):
        removed["name"] = name
        return True

    with patch.object(models_mod.shim.env, "remove_value", fake_remove):
        async with aiohttp.ClientSession() as cs:
            async with cs.delete(
                f"{app_server}/api/models/keys",
                json={"name": "OPENAI_API_KEY"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["ok"] is True
    assert removed["name"] == "OPENAI_API_KEY"


@pytest.mark.asyncio
async def test_delete_key_not_found(app_server) -> None:
    """remove_env_value returning False (key absent) → 404."""
    with patch.object(models_mod.shim.env, "remove_value", lambda name: False):
        async with aiohttp.ClientSession() as cs:
            async with cs.delete(
                f"{app_server}/api/models/keys",
                json={"name": "UNKNOWN_KEY"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 404


@pytest.mark.asyncio
async def test_get_auxiliary(app_server) -> None:
    upstream_resp = (200, {
        "tasks": [
            {"task": "vision", "provider": "auto", "model": "", "base_url": ""},
            {"task": "compression", "provider": "openai", "model": "gpt-4o", "base_url": ""},
        ],
        "main": {"provider": "openrouter", "model": "anthropic/claude-opus"},
    })
    with patch.object(
        models_mod, "_dashboard_request", new=AsyncMock(return_value=upstream_resp)
    ):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/models/auxiliary") as r:
                assert r.status == 200
                data = await r.json()

    assert len(data["tasks"]) == 2
    assert data["tasks"][0]["task"] == "vision"
    assert data["main"]["provider"] == "openrouter"


@pytest.mark.asyncio
async def test_get_auxiliary_unavailable(app_server) -> None:
    with patch.object(models_mod, "_dashboard_request", new=AsyncMock(return_value=None)):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/models/auxiliary") as r:
                assert r.status == 200
                data = await r.json()

    assert data["tasks"] == []
    assert data["error"] == "dashboard_unavailable"


@pytest.mark.asyncio
async def test_assign_main(app_server) -> None:
    """POST /api/models/assign for the main slot."""
    upstream_resp = (200, {"ok": True, "scope": "main", "provider": "openai", "model": "gpt-4o"})
    with patch.object(
        models_mod, "_dashboard_request", new=AsyncMock(return_value=upstream_resp)
    ) as mock_req:
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/models/assign",
                json={"scope": "main", "provider": "openai", "model": "gpt-4o"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["ok"] is True
    mock_req.assert_called_once()
    args, kwargs = mock_req.call_args
    assert args[:2] == ("POST", "/api/model/set")
    assert kwargs["json_body"]["scope"] == "main"
    assert kwargs["json_body"]["provider"] == "openai"
    assert kwargs["json_body"]["model"] == "gpt-4o"


@pytest.mark.asyncio
async def test_assign_auxiliary(app_server) -> None:
    upstream_resp = (200, {"ok": True, "scope": "auxiliary", "tasks": ["vision"]})
    with patch.object(
        models_mod, "_dashboard_request", new=AsyncMock(return_value=upstream_resp)
    ) as mock_req:
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/models/assign",
                json={
                    "scope": "auxiliary",
                    "provider": "openai",
                    "model": "gpt-4o-mini",
                    "task": "vision",
                },
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200

    args, kwargs = mock_req.call_args
    assert kwargs["json_body"]["task"] == "vision"


@pytest.mark.asyncio
async def test_assign_invalid_scope(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/models/assign",
            json={"scope": "nonsense", "provider": "x", "model": "y"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400


@pytest.mark.asyncio
async def test_provider_test_upstream_unavailable(app_server) -> None:
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/models/test/openai",
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 200
            data = await r.json()

    assert data["ok"] is False
    assert data["provider"] == "openai"


class TestMaskHelper:
    def test_long_key_preserves_ends(self):
        result = models_mod._mask("sk-proj-abcdefghijklmnopqrst")
        assert result.startswith("sk-p")
        assert result.endswith("qrst")
        assert "*" in result

    def test_short_key_fully_masked(self):
        assert models_mod._mask("abc") == "***"

    def test_empty_key(self):
        assert models_mod._mask("") == ""


def test_aux_slots_canonical():
    assert models_mod.AUX_TASK_SLOTS == (
        "vision",
        "web_extract",
        "compression",
        "session_search",
        "skills_hub",
        "approval",
        "mcp",
        "title_generation",
        "curator",
    )
