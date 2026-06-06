"""files route tests."""

from __future__ import annotations

import base64
from pathlib import Path

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.routes import files as files_mod


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path, monkeypatch):
    """Boot station with hermes root pointing at ``tmp_path/hermes``."""
    hermes_root = tmp_path / "hermes"
    hermes_root.mkdir()
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()

    # Patch the workspace root resolver to point at our temp dir.
    monkeypatch.setattr(
        files_mod,
        "_root_path",
        lambda name: hermes_root if name == "hermes"
        else (workspace_root if name == "workspace" else None),
    )

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

    # Seed some files for tests to read.
    (hermes_root / "README.md").write_text("# Hello\n", encoding="utf-8")
    (hermes_root / "skills").mkdir()
    (hermes_root / "skills" / "my-skill.md").write_text("# skill body\n", encoding="utf-8")
    (hermes_root / ".env").write_text("SECRET=topsecret\n", encoding="utf-8")
    (hermes_root / "auth.json").write_text("{}", encoding="utf-8")
    (hermes_root / "key.pem").write_text("-----PRIVATE-----\n", encoding="utf-8")
    (hermes_root / "image.bin").write_bytes(b"\x00\x01\x02\x03binarydata\xff\xfe")

    try:
        yield base, hermes_root, workspace_root
    finally:
        await runner.cleanup()
        config_reader.reload()


# Tree


@pytest.mark.asyncio
async def test_tree_lists_safe_entries(app_server):
    base, _hermes, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/tree?root=hermes&path=") as r:
            assert r.status == 200
            data = await r.json()

    names = {e["name"] for e in data["entries"]}
    assert "README.md" in names
    assert "skills" in names
    # Sensitive files filtered.
    assert ".env" not in names
    assert "auth.json" not in names
    assert "key.pem" not in names


@pytest.mark.asyncio
async def test_tree_subdirectory(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/tree?root=hermes&path=skills") as r:
            assert r.status == 200
            data = await r.json()
    assert data["entries"][0]["name"] == "my-skill.md"


# Active workspace / agent cwd


@pytest.mark.asyncio
async def test_active_workspace_default(app_server, monkeypatch):
    """No explicit workspace → name None, cwd = resolved default."""
    base, _, workspace_root = app_server
    monkeypatch.setattr(files_mod, "active_workspace", lambda: (None, None))
    from server.lib import workspace_cwd
    monkeypatch.setattr(workspace_cwd, "resolve_active_cwd", lambda: workspace_root)
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/workspace/active") as r:
            assert r.status == 200
            data = await r.json()
    assert data["name"] is None
    assert data["cwd"] == str(workspace_root)


@pytest.mark.asyncio
async def test_active_workspace_named(app_server, monkeypatch):
    """A chosen workspace → its name + path surface for the chat chip."""
    base, _, workspace_root = app_server
    proj = workspace_root / "proj"
    proj.mkdir()
    monkeypatch.setattr(files_mod, "active_workspace", lambda: ("My Proj", proj))
    from server.lib import workspace_cwd
    monkeypatch.setattr(workspace_cwd, "resolve_active_cwd", lambda: proj)
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/workspace/active") as r:
            assert r.status == 200
            data = await r.json()
    assert data["name"] == "My Proj"
    assert data["cwd"] == str(proj)


@pytest.mark.asyncio
async def test_set_active_workspace_hermes_sentinel(app_server, monkeypatch):
    """Selecting ~/.hermes (the "hermes" sentinel) is accepted and resolves the
    agent cwd to $HERMES_HOME — not a 404 like an unknown workspace id."""
    base, _, _ = app_server
    # Persistence + cwd application are off-thread file writes; stub them so the
    # test asserts the route contract, not the filesystem side effects.
    monkeypatch.setattr(files_mod, "_save_workspaces", lambda data: None)
    from server.lib import workspace_cwd
    monkeypatch.setattr(workspace_cwd, "apply_active_workspace_cwd", lambda: "/home/u/.hermes")
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/files/workspaces/active",
            json={"id": "hermes"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 200, await r.text()
            data = await r.json()
    assert data["active_id"] == "hermes"


def test_active_workspace_hermes_resolves_home(quiet_hms_env, monkeypatch, tmp_path):
    """active_workspace() returns ($HERMES_HOME) for the hermes sentinel."""
    monkeypatch.setattr(files_mod, "_load_workspaces", lambda: {"active_id": "hermes", "workspaces": []})
    name, path = files_mod.active_workspace()
    assert name == "hermes"
    # quiet_hms_env points HERMES_HOME at tmp_path via upstream_paths.hermes_home.
    assert path == files_mod.upstream_paths.hermes_home()


@pytest.mark.asyncio
async def test_tree_unknown_root(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/tree?root=evil") as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "unknown_root"


@pytest.mark.asyncio
async def test_tree_traversal_rejected(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/tree?root=hermes&path=../../etc") as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "path_outside_root"


# Read


@pytest.mark.asyncio
async def test_read_text_file(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/read?root=hermes&path=README.md") as r:
            assert r.status == 200
            data = await r.json()
    assert data["binary"] is False
    assert data["content"] == "# Hello\n"


@pytest.mark.asyncio
async def test_read_binary_returns_base64(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/read?root=hermes&path=image.bin") as r:
            assert r.status == 200
            data = await r.json()
    assert data["binary"] is True
    raw = base64.b64decode(data["content_b64"])
    assert raw.startswith(b"\x00\x01\x02\x03")


@pytest.mark.asyncio
async def test_read_blocked_name(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/read?root=hermes&path=.env") as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "blocked_name"


@pytest.mark.asyncio
async def test_read_pem_blocked(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/read?root=hermes&path=key.pem") as r:
            assert r.status == 400


@pytest.mark.asyncio
async def test_read_missing_file(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/read?root=hermes&path=missing.md") as r:
            assert r.status == 404


# Write


@pytest.mark.asyncio
async def test_write_creates_file(app_server):
    base, hermes_root, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/files/write",
            json={"root": "hermes", "path": "notes/new.md", "content": "hi"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 200

    assert (hermes_root / "notes" / "new.md").read_text() == "hi"


@pytest.mark.asyncio
async def test_write_blocked_name(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/files/write",
            json={"root": "hermes", "path": ".env", "content": "X=Y"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400


@pytest.mark.asyncio
async def test_write_too_large_rejected(app_server):
    base, _, _ = app_server
    huge = "x" * (1024 * 1024 + 100)
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/files/write",
            json={"root": "hermes", "path": "big.txt", "content": huge},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 413


# Delete


@pytest.mark.asyncio
async def test_delete_file(app_server):
    base, hermes_root, _ = app_server
    target = hermes_root / "doomed.txt"
    target.write_text("bye", encoding="utf-8")

    async with aiohttp.ClientSession() as cs:
        async with cs.delete(
            f"{base}/api/files/delete",
            json={"root": "hermes", "path": "doomed.txt"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 200

    assert not target.exists()


@pytest.mark.asyncio
async def test_delete_cannot_remove_root(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.delete(
            f"{base}/api/files/delete",
            json={"root": "hermes", "path": ""},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "cannot_delete_root"


@pytest.mark.asyncio
async def test_delete_nonempty_directory(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.delete(
            f"{base}/api/files/delete",
            json={"root": "hermes", "path": "skills"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400


# Rename


@pytest.mark.asyncio
async def test_rename_file(app_server):
    base, hermes_root, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{base}/api/files/rename",
            json={"root": "hermes", "path": "README.md", "new_name": "INDEX.md"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 200

    assert not (hermes_root / "README.md").exists()
    assert (hermes_root / "INDEX.md").exists()


@pytest.mark.asyncio
async def test_rename_rejects_path_separator(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{base}/api/files/rename",
            json={"root": "hermes", "path": "README.md", "new_name": "subdir/README.md"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400


@pytest.mark.asyncio
async def test_rename_rejects_blocked_target(app_server):
    base, _, _ = app_server
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{base}/api/files/rename",
            json={"root": "hermes", "path": "README.md", "new_name": ".env"},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400


# Pure helpers


class TestBlockedRegex:
    def test_env_blocked(self):
        assert files_mod._is_blocked(".env")
        assert files_mod._is_blocked(".env.local")
        assert files_mod._is_blocked(".ENV")

    def test_auth_blocked(self):
        assert files_mod._is_blocked("auth.json")

    def test_honcho_blocked(self):
        assert files_mod._is_blocked("honcho.json")

    def test_pem_blocked(self):
        assert files_mod._is_blocked("cert.pem")
        assert files_mod._is_blocked("priv.PEM")

    def test_ssh_keys_blocked(self):
        assert files_mod._is_blocked("id_rsa")
        assert files_mod._is_blocked("id_ed25519.pub")

    def test_safe_names(self):
        assert not files_mod._is_blocked("README.md")
        assert not files_mod._is_blocked("config.yaml")
        assert not files_mod._is_blocked("envfile.txt")


# Browse directory (the workspace root) — default ~/, confined under home.


class TestBrowseDir:
    def test_under_home(self, monkeypatch, tmp_path):
        home = tmp_path / "home"
        (home / "proj").mkdir(parents=True)
        monkeypatch.setattr(files_mod, "_home", lambda: home.resolve())
        assert files_mod._under_home(home.resolve())
        assert files_mod._under_home((home / "proj").resolve())
        assert not files_mod._under_home(tmp_path.resolve())  # parent of home

    def test_validate_dir_under_home(self, monkeypatch, tmp_path):
        home = tmp_path / "home"
        home.mkdir()
        proj = home / "proj"
        proj.mkdir()
        monkeypatch.setattr(files_mod, "_home", lambda: home.resolve())
        p, err = files_mod._validate_dir_under_home(str(proj))
        assert err is None and p == proj.resolve()

        outside = tmp_path / "outside"
        outside.mkdir()
        assert files_mod._validate_dir_under_home(str(outside))[1] == "outside_home"

        f = home / "f.txt"
        f.write_text("x")
        assert files_mod._validate_dir_under_home(str(f))[1] == "not_a_directory"
        assert files_mod._validate_dir_under_home(str(home / "nope"))[1] == "not_found"

    def test_current_dir_default_and_fallback(self, monkeypatch, tmp_path):
        home = tmp_path / "home"
        home.mkdir()
        monkeypatch.setattr(files_mod, "_home", lambda: home.resolve())
        monkeypatch.setattr(files_mod, "_load_workspaces", lambda: {})
        assert files_mod._current_dir() == home.resolve()
        # outside-home value → falls back to home
        monkeypatch.setattr(files_mod, "_load_workspaces", lambda: {"current_dir": str(tmp_path)})
        assert files_mod._current_dir() == home.resolve()
        # valid under-home value
        proj = home / "proj"
        proj.mkdir()
        monkeypatch.setattr(files_mod, "_load_workspaces", lambda: {"current_dir": str(proj)})
        assert files_mod._current_dir() == proj.resolve()


@pytest.mark.asyncio
async def test_get_workspace_dir_defaults_home(app_server, monkeypatch, tmp_path):
    base, _, _ = app_server
    home = tmp_path / "home_get"
    home.mkdir()
    monkeypatch.setattr(files_mod, "_home", lambda: home.resolve())
    monkeypatch.setattr(files_mod, "_load_workspaces", lambda: {})
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/workspace/dir") as r:
            assert r.status == 200, await r.text()
            data = await r.json()
    assert data["dir"] == str(home.resolve())
    assert data["home"] == str(home.resolve())


@pytest.mark.asyncio
async def test_set_workspace_dir_under_home(app_server, monkeypatch, tmp_path):
    base, _, _ = app_server
    home = tmp_path / "home_set"
    home.mkdir()
    proj = home / "proj"
    proj.mkdir()
    store = {"data": {}}
    monkeypatch.setattr(files_mod, "_home", lambda: home.resolve())
    monkeypatch.setattr(files_mod, "_load_workspaces", lambda: store["data"])
    monkeypatch.setattr(files_mod, "_save_workspaces", lambda d: store.__setitem__("data", d))
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/files/workspace/dir",
            json={"path": str(proj)},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 200, await r.text()
            data = await r.json()
    assert data["dir"] == str(proj.resolve())
    assert store["data"]["current_dir"] == str(proj.resolve())


@pytest.mark.asyncio
async def test_set_workspace_dir_outside_home_rejected(app_server, monkeypatch, tmp_path):
    base, _, _ = app_server
    home = tmp_path / "home_rej"
    home.mkdir()
    outside = tmp_path / "outside_rej"
    outside.mkdir()
    monkeypatch.setattr(files_mod, "_home", lambda: home.resolve())
    async with aiohttp.ClientSession() as cs:
        async with cs.put(
            f"{base}/api/files/workspace/dir",
            json={"path": str(outside)},
            headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
        ) as r:
            assert r.status == 400, await r.text()
            data = await r.json()
    assert data["error"] == "outside_home"


@pytest.mark.asyncio
async def test_workspace_subdirs_lists_and_parent(app_server, monkeypatch, tmp_path):
    base, _, _ = app_server
    home = tmp_path / "home_sub"
    home.mkdir()
    proj = home / "proj"
    proj.mkdir()
    (proj / "a").mkdir()
    (proj / "b").mkdir()
    (proj / ".hidden").mkdir()  # hidden → filtered
    (proj / "file.txt").write_text("x")  # non-dir → filtered
    monkeypatch.setattr(files_mod, "_home", lambda: home.resolve())
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{base}/api/files/workspace/subdirs?path={proj}") as r:
            assert r.status == 200, await r.text()
            data = await r.json()
    assert [d["name"] for d in data["dirs"]] == ["a", "b"]
    assert data["parent"] == str(home.resolve())
