"""Single-point indirection for upstream-owned paths/labels/IDs.

Anywhere in server/ that needs ~/.hermes / launchd labels / state.db / venv python
MUST go through this module — CI grep-lint enforces no inlined literals elsewhere.
"""

from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def hermes_home() -> Path:
    """Returns absolute ~/.hermes. expanduser+resolve protects against self-referential
    HERMES_HOME='~/.hermes' in .env which would otherwise resolve to $CWD/~/.hermes."""
    from hermes_constants import get_hermes_home  # type: ignore[import-not-found]
    return Path(get_hermes_home()).expanduser().resolve()


@lru_cache(maxsize=1)
def plugins_root() -> Path:
    return hermes_home_for_agent() / "plugins" / "platforms"


@lru_cache(maxsize=1)
def hermes_home_for_agent() -> Path:
    """The hermes-agent source tree root (code), not ~/.hermes (data)."""
    import hermes_cli  # type: ignore[import-not-found]
    mod_file = hermes_cli.__file__
    if mod_file is None:  # namespace package without a concrete __file__
        raise RuntimeError("hermes_cli has no __file__ (namespace package?)")
    return Path(mod_file).resolve().parent.parent


@lru_cache(maxsize=1)
def state_db_path(home: Path | None = None) -> Path:
    """``state.db`` under ``home`` (default: the current HERMES_HOME).

    ``home`` lets the run path address a specific profile's database when the
    Composer pill re-scopes a run.
    """
    return (home if home is not None else hermes_home()) / "state.db"


@lru_cache(maxsize=1)
def hms_data_dir() -> Path:
    d = hermes_home() / "station"
    d.mkdir(parents=True, exist_ok=True)
    return d


def run_snapshots_dir() -> Path:
    """Where in-flight chat turns are checkpointed so a crash can recover the
    partial answer (the live accumulator dies with the process)."""
    d = hms_data_dir() / "run-snapshots"
    d.mkdir(parents=True, exist_ok=True)
    return d


@lru_cache(maxsize=1)
def launchd_label() -> str:
    from hermes_cli.gateway import get_launchd_label  # type: ignore[import-not-found]
    return get_launchd_label()


@lru_cache(maxsize=1)
def systemd_service_name() -> str:
    from hermes_cli.gateway import get_service_name  # type: ignore[import-not-found]
    return get_service_name()


@lru_cache(maxsize=1)
def venv_python() -> str:
    try:
        from hermes_cli.gateway import get_python_path  # type: ignore[import-not-found]
        return get_python_path()
    except Exception:
        return sys.executable


@lru_cache(maxsize=1)
def hermes_executable() -> str:
    """HERMES_BIN env > <venv>/bin/hermes > <venv-python> -m hermes_cli.main.

    Deliberately does NOT prefer the bare ``<agent>/hermes`` wrapper: it ships
    ``#!/usr/bin/env python3``, which resolves to whatever python3 is first on
    PATH — often one without the agent's deps (yaml, …), so a spawned
    ``hermes gateway restart`` crashes with ModuleNotFoundError. The venv entry
    points are pinned to the interpreter that actually hosts the agent.
    """
    import os as _os
    env = _os.getenv("HERMES_BIN")
    if env:
        return env
    try:
        venv_script = hermes_home_for_agent() / "venv" / "bin" / "hermes"
        if venv_script.is_file() and _os.access(venv_script, _os.X_OK):
            return str(venv_script)
    except Exception:
        pass
    return f"{venv_python()} -m hermes_cli.main"


@lru_cache(maxsize=1)
def hms_run_dir() -> Path:
    d = hermes_home() / "run"
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    return d


def reset_caches_for_test() -> None:
    """Drop every path lru_cache so tests that monkeypatch HERMES_HOME see the new value."""
    for fn in (
        hermes_home,
        plugins_root,
        hermes_home_for_agent,
        state_db_path,
        hms_data_dir,
        hms_run_dir,
        launchd_label,
        systemd_service_name,
        venv_python,
        hermes_executable,
    ):
        try:
            fn.cache_clear()
        except AttributeError:
            pass
    try:
        from server.lib import config_reader as _cr
        _cr.reload()
    except Exception:
        pass
    try:
        from server import capabilities as _caps
        _caps._cached = None
    except Exception:
        pass


def is_macos() -> bool:
    return sys.platform == "darwin"


def is_linux() -> bool:
    return sys.platform.startswith("linux")
