"""Pytest configuration — make repo root importable + shared fixtures."""

from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


@pytest.fixture
def quiet_hms_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Isolate station state into tmp_path and disable on_startup spawn hooks."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.delenv("HMS_PASSWORD_HASH", raising=False)
    monkeypatch.delenv("HMS_ALLOWED_HOSTS", raising=False)
    monkeypatch.setenv("HMS_DASHBOARD_AUTOSTART", "0")
    monkeypatch.setenv("HMS_GATEWAY_AUTOSTART", "0")
    # Caches pin HERMES_HOME for the process; tests need a fresh view per monkeypatch.
    from server.lib import upstream_paths
    upstream_paths.reset_caches_for_test()

    # Patch hermes_home directly so tests don't need hermes_constants (lives in agent venv).
    @lru_cache(maxsize=1)
    def _test_hermes_home() -> Path:
        return tmp_path

    monkeypatch.setattr(upstream_paths, "hermes_home", _test_hermes_home)
    # Also patch each module that imported hermes_home at module level —
    # otherwise their local binding still tries to load hermes_constants.
    for mod_path in (
        "server.lib.config_reader",
        "server.lib.plugin_install",
        "server.routes.plugins",
        "server.routes.logs",
        "server.routes.config",
        "server.routes.mcp",
        "server.settings",
        "server.lifecycle",
        "server.capabilities",
    ):
        try:
            mod = __import__(mod_path, fromlist=["hermes_home"])
            if hasattr(mod, "hermes_home"):
                monkeypatch.setattr(mod, "hermes_home", _test_hermes_home)
        except Exception:
            pass

    yield tmp_path
