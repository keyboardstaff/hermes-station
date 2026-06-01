"""``server/lib/profile_run.py`` + ``state_db.db_for_home`` — D17 profile re-scope.

These cover the in-process HERMES_HOME override that lets the Composer profile
pill re-scope a run without a gateway restart (the same mechanism upstream's
cron scheduler uses). They mock ``shim.profiles`` so they run in CI without
hermes-agent installed.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from server.lib import profile_run, state_db
from server.lib.upstream_shim import shim


@pytest.fixture(autouse=True)
def _reset_shim():
    shim.reset_for_test()
    yield
    shim.reset_for_test()


# ── resolve_profile_home ─────────────────────────────────────────────


def test_resolve_default_and_none_are_noop():
    assert profile_run.resolve_profile_home(None) is None
    assert profile_run.resolve_profile_home("") is None
    assert profile_run.resolve_profile_home("default") is None


def test_resolve_named_profile(monkeypatch, tmp_path: Path):
    home = tmp_path / "profiles" / "creative"
    home.mkdir(parents=True)
    monkeypatch.setattr(shim.profiles, "get_profile_dir", lambda name: tmp_path / "profiles" / name)
    assert profile_run.resolve_profile_home("creative") == home.resolve()


def test_resolve_missing_dir_is_none(monkeypatch, tmp_path: Path):
    # get_profile_dir points at a path that doesn't exist → no override.
    monkeypatch.setattr(shim.profiles, "get_profile_dir", lambda name: tmp_path / "nope" / name)
    assert profile_run.resolve_profile_home("ghost") is None


# ── active_profile_name / active_profile_home ──


def test_active_profile_name_nondefault(monkeypatch):
    monkeypatch.setattr(shim.profiles, "get_active", lambda: "creative")
    assert profile_run.active_profile_name() == "creative"


def test_active_profile_name_default_or_blank_is_none(monkeypatch):
    monkeypatch.setattr(shim.profiles, "get_active", lambda: "default")
    assert profile_run.active_profile_name() is None
    monkeypatch.setattr(shim.profiles, "get_active", lambda: "  ")
    assert profile_run.active_profile_name() is None


def test_active_profile_name_no_getter(monkeypatch):
    monkeypatch.setattr(shim.profiles, "get_active", None)
    assert profile_run.active_profile_name() is None


def test_active_profile_home_resolves(monkeypatch, tmp_path: Path):
    home = tmp_path / "profiles" / "creative"
    home.mkdir(parents=True)
    monkeypatch.setattr(shim.profiles, "get_active", lambda: "creative")
    monkeypatch.setattr(shim.profiles, "get_profile_dir", lambda name: tmp_path / "profiles" / name)
    assert profile_run.active_profile_home() == home.resolve()


# ── profile_home_override (context manager) ──────────────────────────


def test_override_sets_and_resets(monkeypatch, tmp_path: Path):
    home = tmp_path / "profiles" / "creative"
    home.mkdir(parents=True)
    monkeypatch.setattr(shim.profiles, "get_profile_dir", lambda name: tmp_path / "profiles" / name)

    calls: dict[str, object] = {}

    def _set(path):
        calls["set"] = path
        return "tok-1"

    def _reset(token):
        calls["reset"] = token

    monkeypatch.setattr(shim.profiles, "set_hermes_home_override", _set)
    monkeypatch.setattr(shim.profiles, "reset_hermes_home_override", _reset)

    with profile_run.profile_home_override("creative") as resolved:
        assert resolved == home.resolve()
        assert calls["set"] == str(home.resolve())
        assert "reset" not in calls  # not reset until exit
    assert calls["reset"] == "tok-1"


def test_override_noop_for_default(monkeypatch):
    # Default → never touches the upstream override API.
    def _boom(*a, **k):  # pragma: no cover - must not be called
        raise AssertionError("override API called for default profile")

    monkeypatch.setattr(shim.profiles, "set_hermes_home_override", _boom)
    with profile_run.profile_home_override("default") as resolved:
        assert resolved is None


def test_override_restores_env_delta(monkeypatch, tmp_path: Path):
    home = tmp_path / "profiles" / "creative"
    home.mkdir(parents=True)
    monkeypatch.setattr(shim.profiles, "get_profile_dir", lambda name: tmp_path / "profiles" / name)
    monkeypatch.setattr(shim.profiles, "set_hermes_home_override", lambda p: "tok")
    monkeypatch.setattr(shim.profiles, "reset_hermes_home_override", lambda t: None)

    monkeypatch.setenv("HMS_PREEXISTING", "orig")
    with profile_run.profile_home_override("creative"):
        os.environ["HMS_ADDED_IN_RUN"] = "leak"
        os.environ["HMS_PREEXISTING"] = "changed"
    # Added key removed; changed key restored.
    assert "HMS_ADDED_IN_RUN" not in os.environ
    assert os.environ["HMS_PREEXISTING"] == "orig"


def test_override_missing_api_fails_open(monkeypatch, tmp_path: Path):
    home = tmp_path / "profiles" / "creative"
    home.mkdir(parents=True)
    monkeypatch.setattr(shim.profiles, "get_profile_dir", lambda name: tmp_path / "profiles" / name)
    # Upstream too old: no override symbols.
    monkeypatch.setattr(shim.profiles, "set_hermes_home_override", None)
    monkeypatch.setattr(shim.profiles, "reset_hermes_home_override", None)
    with profile_run.profile_home_override("creative") as resolved:
        assert resolved is None  # falls open to process default, no crash


# ── state_db.db_for_home ─────────────────────────────────────────────


def test_db_for_home_none_returns_default(monkeypatch):
    sentinel = object()
    monkeypatch.setattr(state_db, "_SessionDB", lambda: (lambda *a, **k: sentinel))
    # default singleton path
    state_db._singleton = None
    assert state_db.db_for_home(None) is sentinel


def test_db_for_home_caches_per_home(monkeypatch, tmp_path: Path):
    built: list[Path] = []

    class _FakeDB:
        def __init__(self, db_path=None):
            built.append(db_path)

        def close(self):
            pass

    monkeypatch.setattr(state_db, "_SessionDB", lambda: _FakeDB)
    state_db._by_home.clear()

    a = tmp_path / "profiles" / "alpha"
    a.mkdir(parents=True)
    first = state_db.db_for_home(a)
    second = state_db.db_for_home(a)
    assert first is second  # cached — built once
    assert built == [a.resolve() / "state.db"]

    b = tmp_path / "profiles" / "beta"
    b.mkdir(parents=True)
    other = state_db.db_for_home(b)
    assert other is not first
    assert built[-1] == b.resolve() / "state.db"
    state_db._by_home.clear()
