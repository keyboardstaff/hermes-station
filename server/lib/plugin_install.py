"""Plugin install/uninstall + status — symlinks under hermes-agent/plugins/platforms/station/."""

from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from server.lib import yaml_edit
from server.lib.upstream_paths import hermes_home, plugins_root

logger = logging.getLogger(__name__)


PLATFORM_PATH = ("platforms", "station")
ENABLED_PATH = (*PLATFORM_PATH, "enabled")

# __init__.py is generated (not symlinked) for a stable plugin entry surface.
LINKED_ENTRIES = ("server", "plugin.yaml", "dist")


@dataclass(frozen=True)
class PluginStatus:
    plugin_dir: Path
    plugin_link_dir: Path
    files_installed: bool
    config_enabled: bool
    config_present: bool


def plugin_repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def plugin_link_path() -> Path:
    return plugins_root() / "station"


def get_plugin_status() -> PluginStatus:
    repo = plugin_repo_root()
    link_dir = plugin_link_path()
    files_installed = link_dir.exists() and all(
        (link_dir / name).exists() for name in (*LINKED_ENTRIES, "__init__.py")
    )

    config_yaml = hermes_home() / "config.yaml"
    config_present = config_yaml.exists()
    config_enabled = False
    if config_present:
        try:
            import yaml  # type: ignore[import-not-found]
            doc = yaml.safe_load(config_yaml.read_text(encoding="utf-8")) or {}
            cursor: Any = doc
            for key in PLATFORM_PATH:
                cursor = cursor.get(key) if isinstance(cursor, dict) else None
                if cursor is None:
                    break
            # Section presence is the enable signal — upstream treats it as opt-in.
            config_enabled = cursor is not None
        except Exception:
            config_enabled = False

    return PluginStatus(
        plugin_dir=repo,
        plugin_link_dir=link_dir,
        files_installed=files_installed,
        config_enabled=config_enabled,
        config_present=config_present,
    )


def _replace_with_symlink(src: Path, dst: Path) -> None:
    if dst.is_symlink() or dst.exists():
        if dst.is_dir() and not dst.is_symlink():
            shutil.rmtree(dst)
        else:
            dst.unlink()
    dst.symlink_to(src)


def symlink_plugin(*, force: bool = False) -> list[dict[str, str]]:
    repo = plugin_repo_root()
    link_dir = plugin_link_path()
    link_dir.parent.mkdir(parents=True, exist_ok=True)
    link_dir.mkdir(exist_ok=True)

    out: list[dict[str, str]] = []
    for name in LINKED_ENTRIES:
        src = repo / name
        if not src.exists() and name == "dist":
            # dist/ may not exist before `pnpm build` — materialise so symlink resolves.
            src.mkdir(parents=True, exist_ok=True)
        if not src.exists():
            raise RuntimeError(f"plugin source missing: {src}")
        dst = link_dir / name
        if dst.is_symlink() and dst.resolve() == src.resolve() and not force:
            out.append({"name": name, "action": "skip"})
            continue
        _replace_with_symlink(src, dst)
        out.append({"name": name, "action": "linked"})

    init_path = link_dir / "__init__.py"
    # Self-publish plugin dir to sys.path so `server.X` absolute imports inside
    # adapter.py resolve under the gateway's plugin loader.
    init_body = (
        "import sys\n"
        "from pathlib import Path\n"
        "_plugin_dir = str(Path(__file__).resolve().parent)\n"
        "if _plugin_dir not in sys.path:\n"
        "    sys.path.insert(0, _plugin_dir)\n"
        "from server import register\n\n"
        "__all__ = [\"register\"]\n"
    )
    if not init_path.exists() or init_path.read_text(encoding="utf-8") != init_body:
        init_path.write_text(init_body, encoding="utf-8")
        out.append({"name": "__init__.py", "action": "written"})
    return out


def enable_in_config() -> bool:
    """Idempotent; returns True iff the file was written."""
    config_yaml = hermes_home() / "config.yaml"
    if not config_yaml.exists():
        config_yaml.write_text("", encoding="utf-8")
    src = config_yaml.read_text(encoding="utf-8")
    new_src = yaml_edit.set_scalar_at_path(src, ENABLED_PATH, True)
    if new_src == src:
        return False
    yaml_edit.write_text_atomic(config_yaml, new_src, mode=0o600)
    return True


def install_plugin(*, force: bool = False) -> dict[str, Any]:
    files = symlink_plugin(force=force)
    patched = enable_in_config()
    return {"files": files, "config_patched": patched}


def remove_symlink() -> dict[str, Any]:
    link_dir = plugin_link_path()
    if not link_dir.exists():
        return {"action": "absent"}
    removed: list[str] = []
    for name in (*LINKED_ENTRIES, "__init__.py"):
        p = link_dir / name
        if p.is_symlink() or p.exists():
            try:
                if p.is_dir() and not p.is_symlink():
                    shutil.rmtree(p)
                else:
                    p.unlink()
                removed.append(name)
            except Exception:
                logger.exception("[hms.plugin_install] failed to remove %s", p)
    try:
        next(iter(link_dir.iterdir()))
    except StopIteration:
        link_dir.rmdir()
    return {"action": "removed", "files": removed}


def uninstall_plugin() -> dict[str, Any]:
    return remove_symlink()


def purge_from_config() -> bool:
    """Drop platforms.station section; returns True iff the file was written."""
    config_yaml = hermes_home() / "config.yaml"
    if not config_yaml.exists():
        return False
    src = config_yaml.read_text(encoding="utf-8")
    new_src = yaml_edit.remove_at_path(src, PLATFORM_PATH)
    if new_src == src:
        return False
    yaml_edit.write_text_atomic(config_yaml, new_src, mode=0o600)
    return True


def disable_in_config() -> bool:
    """Set enabled:false without removing section — preserves user-edited extras."""
    config_yaml = hermes_home() / "config.yaml"
    if not config_yaml.exists():
        return False
    src = config_yaml.read_text(encoding="utf-8")
    new_src = yaml_edit.set_scalar_at_path(src, ENABLED_PATH, False)
    if new_src == src:
        return False
    yaml_edit.write_text_atomic(config_yaml, new_src, mode=0o600)
    return True


__all__ = [
    "PluginStatus",
    "PLATFORM_PATH",
    "ENABLED_PATH",
    "LINKED_ENTRIES",
    "plugin_repo_root",
    "plugin_link_path",
    "get_plugin_status",
    "symlink_plugin",
    "enable_in_config",
    "install_plugin",
    "remove_symlink",
    "uninstall_plugin",
    "disable_in_config",
    "purge_from_config",
]
