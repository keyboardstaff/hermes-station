"""First-run onboarding: /api/onboarding persists name/password/onboarded, and
login treats a configured login name as a required credential."""

from __future__ import annotations

import json

import pytest
from aiohttp.test_utils import make_mocked_request


def _json_req(method: str, path: str, body: dict):
    req = make_mocked_request(method, path, headers={"Content-Type": "application/json"})

    async def _j():
        return body
    req.json = _j  # type: ignore[method-assign]
    return req


@pytest.mark.asyncio
async def test_onboarding_persists_name_and_flag(quiet_hms_env) -> None:
    from server.lib import config_reader
    from server.routes import onboarding

    assert config_reader.hms_onboarded() is False
    resp = await onboarding.complete_onboarding(
        _json_req("POST", "/api/onboarding", {"user_name": "  Ada  "}),
    )
    assert json.loads(resp.body)["ok"] is True
    config_reader.reload()
    assert config_reader.hms_user_name() == "Ada"
    assert config_reader.hms_onboarded() is True
    assert config_reader.hms_password_hash() == ""  # password optional


@pytest.mark.asyncio
async def test_onboarding_sets_password_when_given(quiet_hms_env) -> None:
    from server.lib import argon2_hash, config_reader
    from server.routes import onboarding

    await onboarding.complete_onboarding(
        _json_req("POST", "/api/onboarding", {"user_name": "Ada", "password": "hunter2hunter"}),
    )
    config_reader.reload()
    assert argon2_hash.verify_password(config_reader.hms_password_hash(), "hunter2hunter")


@pytest.mark.asyncio
async def test_onboarding_rejects_short_password(quiet_hms_env) -> None:
    from server.routes import onboarding

    resp = await onboarding.complete_onboarding(
        _json_req("POST", "/api/onboarding", {"password": "short"}),
    )
    assert resp.status == 400
    assert json.loads(resp.body)["error"] == "invalid_password"


@pytest.mark.asyncio
async def test_login_requires_matching_username_when_configured(quiet_hms_env) -> None:
    from server import settings as settings_mod
    from server.lib import argon2_hash, config_reader
    from server.routes import login as login_mod

    settings_mod.apply_extra_update({
        "user_name": "ada",
        "password_hash": argon2_hash.hash_password("hunter2hunter"),
    })
    config_reader.reload()
    login_mod._LOGIN_BUCKET.clear()  # noqa: SLF001

    # Right password but wrong/missing username → rejected.
    bad = await login_mod.handle_login(
        _json_req("POST", "/api/login", {"username": "bob", "password": "hunter2hunter"}),
    )
    assert bad.status == 401

    # Right username + password → ok.
    login_mod._LOGIN_BUCKET.clear()  # noqa: SLF001
    ok = await login_mod.handle_login(
        _json_req("POST", "/api/login", {"username": "ada", "password": "hunter2hunter"}),
    )
    assert ok.status == 200
