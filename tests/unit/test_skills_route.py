"""`/api/skills` + `/api/toolsets` profile view-scope (``?profile=``).

The skills/toolsets reads resolve paths from the active ``HERMES_HOME``, so
``?profile=<name>`` must run them inside ``profile_home_override(<name>)``. We
swap the upstream shim for fakes and spy on the override to assert the scope is
applied (and that a malformed profile is rejected before any read).
"""

from __future__ import annotations

import contextlib
from pathlib import Path
from unittest.mock import patch

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.lib.upstream_shim import shim


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {"host": "127.0.0.1", "port": 3131}}}}),
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


@contextlib.contextmanager
def _skills_env(seen: list[str | None]):
    """Fake the skills shim + agent_importable, and spy on the home override so
    tests can assert which profile each read was scoped under."""

    @contextlib.contextmanager
    def _spy(profile):
        seen.append(profile)
        yield None

    with (
        patch.object(shim.flags, "agent_importable", True),
        patch.object(shim.skills, "find_all", return_value=[{"name": "alpha", "description": "d"}]),
        patch.object(shim.skills, "get_disabled", return_value=set()),
        patch.object(shim.skills, "load_config", return_value={}),
        patch.object(shim.skills, "hub_lock_file", None),
        patch("server.routes.skills_content.profile_home_override", _spy),
    ):
        yield


@pytest.mark.asyncio
async def test_skills_profile_scopes_the_read(app_server):
    seen: list[str | None] = []
    with _skills_env(seen):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/skills?profile=creative") as r:
                assert r.status == 200
                data = await r.json()
    assert data["skills"][0]["name"] == "alpha"
    assert seen == ["creative"]  # the read ran under the creative home override


@pytest.mark.asyncio
async def test_skills_default_and_omitted_use_process_home(app_server):
    seen: list[str | None] = []
    with _skills_env(seen):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/skills?profile=default") as r:
                assert r.status == 200
            async with cs.get(f"{app_server}/api/skills") as r:
                assert r.status == 200
    # default / omitted → no named override (profile_home_override no-ops on None).
    assert seen == [None, None]


@pytest.mark.asyncio
async def test_skills_invalid_profile_rejected_before_read(app_server):
    seen: list[str | None] = []
    with _skills_env(seen):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/skills?profile=Bad!Name") as r:
                assert r.status == 400
                assert (await r.json())["error"] == "invalid_profile"
    assert seen == []  # rejected before the override / read


@pytest.mark.asyncio
async def test_toolsets_profile_scopes_the_read(app_server):
    seen: list[str | None] = []

    @contextlib.contextmanager
    def _spy(profile):
        seen.append(profile)
        yield None

    with (
        patch.object(shim.flags, "agent_importable", True),
        patch.object(shim.toolsets, "list_configurable", return_value=[("web", "Web", "desc")]),
        patch.object(shim.toolsets, "get_platform_tools", return_value=["web"]),
        patch.object(shim.toolsets, "load_config", return_value={}),
        patch.object(shim.toolsets, "resolve", return_value=["fetch"]),
        patch.object(shim.toolsets, "has_keys", return_value=True),
        patch("server.routes.skills_content.profile_home_override", _spy),
    ):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/toolsets?profile=creative") as r:
                assert r.status == 200
                data = await r.json()
    assert data["toolsets"][0]["name"] == "web"
    assert seen == ["creative"]
