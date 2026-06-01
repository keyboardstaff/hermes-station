"""``server/lib/workspace_cwd.py`` — agent cwd resolution.

Pins the fix where the default (no explicit workspace) resolves to ``~/workspace``
and *creates it on demand*, so the agent never falls back to the process cwd
(which in dev is the repo, not the user's workspace).
"""

from __future__ import annotations

from pathlib import Path

from server.lib import workspace_cwd
from server.routes import files as files_mod


def test_default_resolves_to_workspace_and_creates_it(monkeypatch, tmp_path: Path):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(workspace_cwd.Path, "home", classmethod(lambda cls: home))
    # No explicit workspace active.
    monkeypatch.setattr(files_mod, "active_workspace", lambda: (None, None))

    ws = home / "workspace"
    assert not ws.exists()
    resolved = workspace_cwd.resolve_active_cwd()
    assert resolved == ws
    assert ws.is_dir()  # created on demand


def test_explicit_workspace_wins(monkeypatch, tmp_path: Path):
    proj = tmp_path / "proj"
    proj.mkdir()
    monkeypatch.setattr(files_mod, "active_workspace", lambda: ("Proj", proj))
    assert workspace_cwd.resolve_active_cwd() == proj


def test_hermes_sentinel_path(monkeypatch, tmp_path: Path):
    # The "hermes" sentinel surfaces $HERMES_HOME as the cwd (no creation).
    home = tmp_path / "dot-hermes"
    home.mkdir()
    monkeypatch.setattr(files_mod, "active_workspace", lambda: ("hermes", home))
    assert workspace_cwd.resolve_active_cwd() == home
