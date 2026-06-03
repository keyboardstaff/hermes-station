"""``server/routes/profiles.py`` — per-Profile config.yaml editor endpoints.

GET/PUT ``/api/profiles/{name}/config`` edit ``<profile_dir>/config.yaml``
directly (the default profile resolves to ~/.hermes/config.yaml). Same
raw-YAML + sha256 optimistic-lock contract as ``/api/config/yaml`` — but
profile-scoped, since the dashboard can only reach the active profile.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app

PROFILE = "default"
_CSRF = {"X-HMS-CSRF": "1", "Content-Type": "application/json"}


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@pytest.fixture
async def app_server(quiet_hms_env, monkeypatch, tmp_path: Path):
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {"host": "127.0.0.1", "port": 3131}}}}),
        encoding="utf-8",
    )
    from server.lib import config_reader
    config_reader.reload()

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
        yield base, profiles_root / PROFILE
    finally:
        await runner.cleanup()
        config_reader.reload()
        upstream_shim.shim.reset_for_test()


@pytest.mark.asyncio
async def test_get_missing_returns_empty(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/config") as r:
            assert r.status == 200
            data = await r.json()
    assert data["yaml"] == ""
    assert data["sha256"] == _sha("")
    assert data["path"].endswith(f"{PROFILE}/config.yaml")


@pytest.mark.asyncio
async def test_put_then_get_roundtrip(app_server):
    base, prof = app_server
    text = "model: gpt-4\nagent:\n  personalities: {}\n"
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/config") as r:
            cur = (await r.json())["sha256"]
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/config",
            json={"yaml_text": text, "expected_sha256": cur},
            headers=_CSRF,
        ) as r:
            assert r.status == 200, await r.text()
            assert (await r.json())["sha256"] == _sha(text)
        async with cs.get(f"{base}/api/profiles/{PROFILE}/config") as r:
            assert (await r.json())["yaml"] == text
    # Written to the documented per-profile location.
    assert (prof / "config.yaml").read_text(encoding="utf-8") == text


@pytest.mark.asyncio
async def test_put_stale_sha_conflicts(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/config",
            json={"yaml_text": "model: x\n", "expected_sha256": "stale-sha"},
            headers=_CSRF,
        ) as r:
            assert r.status == 409
            assert (await r.json())["error"] == "conflict"


@pytest.mark.asyncio
async def test_put_invalid_yaml_rejected(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/config") as r:
            cur = (await r.json())["sha256"]
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/config",
            json={"yaml_text": "key: [unterminated\n", "expected_sha256": cur},
            headers=_CSRF,
        ) as r:
            assert r.status == 400
            assert (await r.json())["error"] == "invalid_yaml"


@pytest.mark.asyncio
async def test_invalid_profile_name_rejected(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/Bad%20Name/config") as r:
            assert r.status == 400
            assert (await r.json())["error"] == "invalid_profile_name"


# ── FORM mode: /config/values (parse for read, dot-path write) ───────


@pytest.mark.asyncio
async def test_get_values_parses_yaml(app_server):
    base, prof = app_server
    prof.mkdir(parents=True, exist_ok=True)
    (prof / "config.yaml").write_text("model: old\nagent:\n  max_steps: 3\n", encoding="utf-8")
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/config/values") as r:
            assert r.status == 200
            data = await r.json()
    assert data["values"]["model"] == "old"
    assert data["values"]["agent"]["max_steps"] == 3


@pytest.mark.asyncio
async def test_get_personalities_parses_both_shapes(app_server):
    base, prof = app_server
    prof.mkdir(parents=True, exist_ok=True)
    (prof / "config.yaml").write_text(
        "agent:\n"
        "  personalities:\n"
        "    coder: 'You are a terse engineer.'\n"
        "    mentor:\n"
        "      description: Patient teacher\n"
        "      system_prompt: 'Explain step by step.'\n",
        encoding="utf-8",
    )
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/personalities") as r:
            assert r.status == 200
            data = await r.json()
    ps = {p["name"]: p for p in data["personalities"]}
    assert ps["coder"]["prompt"] == "You are a terse engineer."
    assert ps["coder"]["description"] == ""
    assert ps["mentor"]["description"] == "Patient teacher"
    assert ps["mentor"]["prompt"] == "Explain step by step."


@pytest.mark.asyncio
async def test_get_personalities_empty_when_none(app_server):
    base, prof = app_server
    prof.mkdir(parents=True, exist_ok=True)
    (prof / "config.yaml").write_text("model: x\n", encoding="utf-8")
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/personalities") as r:
            assert (await r.json())["personalities"] == []


# ── export / import ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_export_streams_archive(app_server, monkeypatch):
    base, _ = app_server
    from server.lib import upstream_shim

    def _fake_export(name, out):
        Path(out).write_bytes(b"FAKEGZ")
        return out

    monkeypatch.setattr(upstream_shim.shim.profiles, "export_profile", _fake_export)
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/export") as r:
            assert r.status == 200
            assert r.headers["Content-Disposition"] == f'attachment; filename="{PROFILE}.tar.gz"'
            assert await r.read() == b"FAKEGZ"


@pytest.mark.asyncio
async def test_export_unavailable_when_absent(app_server, monkeypatch):
    base, _ = app_server
    from server.lib import upstream_shim
    monkeypatch.setattr(upstream_shim.shim.profiles, "export_profile", None)
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/export") as r:
            assert r.status == 503


@pytest.mark.asyncio
async def test_import_creates_profile(app_server, monkeypatch, tmp_path):
    base, _ = app_server
    from server.lib import upstream_shim
    captured: dict = {}

    def _fake_import(arc, name):
        captured["name"] = name
        captured["bytes"] = Path(arc).read_bytes()
        return tmp_path / "imported_profile"

    monkeypatch.setattr(upstream_shim.shim.profiles, "import_profile", _fake_import)
    form = aiohttp.FormData()
    form.add_field("file", b"ARCHIVE", filename="p.tar.gz", content_type="application/gzip")
    form.add_field("name", "imported_profile")
    async with aiohttp.ClientSession() as cs:
        async with cs.post(f"{base}/api/profiles/import", data=form, headers={"X-HMS-CSRF": "1"}) as r:
            assert r.status == 200
            assert await r.json() == {"ok": True, "name": "imported_profile"}
    assert captured["name"] == "imported_profile"
    assert captured["bytes"] == b"ARCHIVE"


@pytest.mark.asyncio
async def test_import_no_file_rejected(app_server, monkeypatch):
    base, _ = app_server
    from server.lib import upstream_shim
    # Upstream present (else the route 503s before reaching the no-file check).
    monkeypatch.setattr(upstream_shim.shim.profiles, "import_profile", lambda *a: None)
    form = aiohttp.FormData()
    form.add_field("name", "x", content_type="text/plain")  # content_type → multipart
    async with aiohttp.ClientSession() as cs:
        async with cs.post(f"{base}/api/profiles/import", data=form, headers={"X-HMS-CSRF": "1"}) as r:
            assert r.status == 400
            assert (await r.json())["error"] == "no_file"


@pytest.mark.asyncio
async def test_import_requires_csrf(app_server):
    base, _ = app_server
    form = aiohttp.FormData()
    form.add_field("file", b"X", filename="p.tar.gz", content_type="application/gzip")
    async with aiohttp.ClientSession() as cs:
        async with cs.post(f"{base}/api/profiles/import", data=form) as r:
            assert r.status == 403


@pytest.mark.asyncio
async def test_put_values_sets_dotpaths_and_preserves_comments(app_server):
    base, prof = app_server
    prof.mkdir(parents=True, exist_ok=True)
    (prof / "config.yaml").write_text("# keep me\nmodel: old\n", encoding="utf-8")
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/config/values") as r:
            sha = (await r.json())["sha256"]
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/config/values",
            json={"updates": {"model": "new", "agent.max_steps": 7}, "expected_sha256": sha},
            headers=_CSRF,
        ) as r:
            assert r.status == 200, await r.text()
    raw = (prof / "config.yaml").read_text(encoding="utf-8")
    assert "# keep me" in raw  # comment preserved by yaml_edit
    parsed = yaml.safe_load(raw)
    assert parsed["model"] == "new"
    assert parsed["agent"]["max_steps"] == 7  # nested dot-path created


@pytest.mark.asyncio
async def test_put_values_stale_sha_conflicts(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/config/values",
            json={"updates": {"model": "x"}, "expected_sha256": "stale"},
            headers=_CSRF,
        ) as r:
            assert r.status == 409


@pytest.mark.asyncio
async def test_put_values_rejects_empty_updates(app_server):
    base, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/profiles/{PROFILE}/config/values") as r:
            sha = (await r.json())["sha256"]
        async with cs.put(
            f"{base}/api/profiles/{PROFILE}/config/values",
            json={"updates": {}, "expected_sha256": sha},
            headers=_CSRF,
        ) as r:
            assert r.status == 400
            assert (await r.json())["error"] == "updates_required"
