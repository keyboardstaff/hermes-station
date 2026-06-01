"""``hms uninstall`` must roll back to a pristine state."""

from __future__ import annotations

from pathlib import Path

import yaml
from server.cli import main as cli_main
from server.lib import config_reader, plugin_install, upstream_paths


def _patch_hermes_home(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    upstream_paths.reset_caches_for_test()
    monkeypatch.setattr(upstream_paths, "hermes_home", lambda: tmp_path)
    for mod_path in (
        "server.lib.config_reader",
        "server.lib.plugin_install",
        "server.settings",
    ):
        try:
            mod = __import__(mod_path, fromlist=["hermes_home"])
            if hasattr(mod, "hermes_home"):
                monkeypatch.setattr(mod, "hermes_home", lambda: tmp_path)
        except Exception:
            pass


def _setup_hermes_home(monkeypatch, tmp_path: Path) -> Path:
    _patch_hermes_home(monkeypatch, tmp_path)

    (tmp_path / "config.yaml").write_text(
        "# user comment kept across edits\n"
        "platforms:\n"
        "  other:\n"
        "    enabled: true\n",
        encoding="utf-8",
    )

    plugins_dir = tmp_path / "hermes-agent" / "plugins" / "platforms"
    plugins_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(upstream_paths, "plugins_root", lambda: plugins_dir)
    monkeypatch.setattr(plugin_install, "plugins_root", lambda: plugins_dir)

    config_reader.reload()
    return tmp_path


def test_uninstall_purges_config_section_by_default(monkeypatch, tmp_path: Path) -> None:
    home = _setup_hermes_home(monkeypatch, tmp_path)

    # Install symlinks + enable in config.
    plugin_install.install_plugin(force=True)

    link_dir = plugin_install.plugin_link_path()
    assert link_dir.exists()
    assert (link_dir / "server").exists()
    doc = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert "station" in doc["platforms"]
    rc = cli_main(["uninstall"])
    assert rc == 0

    # Symlinks gone, dir empty enough to be removed.
    assert not link_dir.exists() or not any(link_dir.iterdir())

    # Station section removed; sibling + comment preserved.
    raw = (home / "config.yaml").read_text(encoding="utf-8")
    assert "station:" not in raw
    assert "# user comment kept across edits" in raw
    doc_after = yaml.safe_load(raw)
    assert "other" in doc_after["platforms"]
    assert "station" not in doc_after["platforms"]


def test_uninstall_keep_config_leaves_section(monkeypatch, tmp_path: Path) -> None:
    home = _setup_hermes_home(monkeypatch, tmp_path)
    plugin_install.install_plugin(force=True)

    rc = cli_main(["uninstall", "--keep-config"])
    assert rc == 0

    doc = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert "station" in doc["platforms"]


def test_uninstall_idempotent(monkeypatch, tmp_path: Path) -> None:
    _setup_hermes_home(monkeypatch, tmp_path)
    # Never installed — uninstall should not raise / should return 0.
    rc = cli_main(["uninstall"])
    assert rc == 0


