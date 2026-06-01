"""Bridge the active workspace to the agent's working directory.

The agent's terminal / file / code tools resolve their cwd from the
``TERMINAL_CWD`` env var (upstream ``gateway/run.py`` bridges it from
``config.yaml terminal.cwd``; the tools re-read it per call). Station runs
in the gateway process, so switching the active workspace sets the env var
live (effective on the next tool call, no restart) and persists
``terminal.cwd`` to the active profile's config.yaml for future sessions.

Single-user local assumption: ``TERMINAL_CWD`` is process-global.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from server.lib import upstream_paths, yaml_edit

logger = logging.getLogger(__name__)


def resolve_active_cwd() -> Path:
    """Active workspace abs path; the default (no explicit workspace) is
    ``~/workspace``, created on demand so the agent never falls back to the
    process cwd (which in dev is the repo, not the user's workspace).
    """
    from server.routes.files import active_workspace  # lazy: files owns workspaces.json
    _, path = active_workspace()
    if path is not None:
        return path
    default = Path.home() / "workspace"
    if not default.is_dir():
        try:
            default.mkdir(parents=True, exist_ok=True)
        except OSError:
            logger.warning("[hms.workspace_cwd] could not create %s", default, exc_info=True)
            return upstream_paths.hermes_home()
    return default


def apply_active_workspace_cwd() -> str:
    """Set TERMINAL_CWD live + persist terminal.cwd to the profile config."""
    cwd = str(resolve_active_cwd())
    os.environ["TERMINAL_CWD"] = cwd
    cfg = upstream_paths.hermes_home() / "config.yaml"
    if cfg.is_file():
        try:
            text = cfg.read_text(encoding="utf-8")
            text = yaml_edit.set_scalar_at_path(text, ["terminal", "cwd"], cwd)
            yaml_edit.write_text_atomic(cfg, text)
        except Exception:
            logger.exception("[hms.workspace_cwd] persist terminal.cwd failed")
    return cwd


__all__ = ["resolve_active_cwd", "apply_active_workspace_cwd"]
