"""``server/routes/profiles.py`` — per-profile memory tab CRUD endpoints.

Memory docs are now namespaced per profile and served from
``/api/profiles/{name}/memory/{tab}`` (see ``_MEMORY_FILES`` /
``_memory_path`` in ``server/routes/profiles.py``). The legacy
``/api/fs/memory/{tab}`` route was removed when memory became
profile-scoped; the frontend source of truth is ``src/hooks/useProfiles.ts``.
"""

from __future__ import annotations

from pathlib import Path

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app

# Profile id used throughout — matches upstream's ``_PROFILE_ID_RE``.
PROFILE = "default"


@pytest.fixture
async def app_server(quiet_hms_env, monkeypatch, tmp_path: Path):
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {
            "host": "127.0.0.1",
            "port": 3131,
        }}}}),
        encoding="utf-8",
    )

    from server.lib import config_reader
    config_reader.reload()

    # Point the profiles shim at a tmp dir tree so ``_memory_path`` resolves
    # to ``<profiles_root>/<name>/memories/<file>`` without touching real state.
    from server.lib import upstream_shim
    upstream_shim.shim.reset_for_test()
    profiles_root = tmp_path / "profiles"
    monkeypatch.setattr(
        upstream_shim.shim.profiles,
        "get_profile_dir",
        lambda name: profiles_root / name,
    )

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    base = f"http://{host}:{port}"
    try:
        # ``prof_dir`` is the resolved HERMES_HOME-equivalent for PROFILE.
        yield base, profiles_root / PROFILE
    finally:
        await runner.cleanup()
        config_reader.reload()
        upstream_shim.shim.reset_for_test()


@pytest.mark.asyncio
async def test_get_missing_file_returns_empty_string(app_server):
    """A profile with no MEMORY.md yet returns ``content: ""`` (not a 404)."""
    base, _prof = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/memory/memory") as r:
            assert r.status == 200
            data = await r.json()
    assert data["content"] == ""
    assert data["exists"] is False


@pytest.mark.asyncio
async def test_get_returns_existing_content(app_server):
    base, prof = app_server
    target = prof / "memories" / "MEMORY.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("# my memory\nhello world\n", encoding="utf-8")

    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/memory/memory") as r:
            assert r.status == 200
            data = await r.json()
    assert data["content"] == "# my memory\nhello world\n"
    assert data["exists"] is True


@pytest.mark.asyncio
async def test_get_unknown_tab_rejected(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/memory/nonsense") as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "unknown_tab"


@pytest.mark.asyncio
async def test_get_invalid_profile_name_rejected(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/Bad%20Name/memory/memory") as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "invalid_profile_name"


@pytest.mark.asyncio
@pytest.mark.parametrize("tab,relpath", [
    ("memory", "memories/MEMORY.md"),
    ("user",   "memories/USER.md"),
])
async def test_each_tab_maps_to_documented_file(app_server, tab, relpath):
    base, prof = app_server
    target = prof / relpath
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(f"content of {tab}", encoding="utf-8")

    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/memory/{tab}") as r:
            assert r.status == 200
            data = await r.json()
    assert data["content"] == f"content of {tab}"


@pytest.mark.asyncio
async def test_put_writes_atomically(app_server):
    """Content survives a round-trip GET; no intermediate tmp files leak."""
    base, prof = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/memory/memory",
            json={"content": "fresh memory"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 200
            data = await r.json()
            assert data["ok"] is True

        # GET surfaces what PUT wrote.
        async with cs.get(f"{base}/api/profiles/{PROFILE}/memory/memory") as r:
            assert r.status == 200
            data = await r.json()
            assert data["content"] == "fresh memory"

    # And the on-disk file is at the documented location.
    assert (prof / "memories" / "MEMORY.md").read_text() == "fresh memory"
    # No leftover .tmp files in the parent dir.
    assert not list((prof / "memories").glob("*.tmp"))


@pytest.mark.asyncio
async def test_put_unknown_tab_returns_400(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/memory/notathing",
            json={"content": "x"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "unknown_tab"


@pytest.mark.asyncio
async def test_put_invalid_json(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/memory/memory",
            data=b"not json",
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "invalid_json"


@pytest.mark.asyncio
async def test_put_content_must_be_string(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/memory/memory",
            json={"content": 12345},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "invalid_content"


@pytest.mark.asyncio
async def test_put_rejects_content_too_large(app_server):
    """Hard cap at the route level — protects the editor from a runaway.

    ``_MAX_MEMORY_BYTES`` is 5 MiB; send 6 to definitively exceed it.
    aiohttp's ``client_max_size`` is 10 MiB (see ``server/app.py``) so the
    request body itself reaches the handler — we want to test the in-route
    guard, not the aiohttp pre-read cap.
    """
    base, _ = app_server
    huge = "x" * (6 * 1024 * 1024)
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/memory/memory",
            json={"content": huge},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 413
            data = await r.json()
            assert data["error"] == "content_too_large"
