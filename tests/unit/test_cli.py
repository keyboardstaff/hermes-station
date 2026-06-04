"""hms CLI dev-command transport selection (Unix socket vs TCP vs bare-exec)."""

from __future__ import annotations

import argparse
import os

import pytest
from server import cli


@pytest.fixture(autouse=True)
def _restore_env():
    # _cmd_dev assigns os.environ["HMS_DEV_SOCK"/"HMS_PORT"] directly, which
    # monkeypatch can't undo — snapshot/restore so it can't leak into other tests.
    saved = dict(os.environ)
    yield
    os.environ.clear()
    os.environ.update(saved)


def _args(**kw) -> argparse.Namespace:
    base = {"host": None, "port": None, "reload": False, "verbose": False, "_inner": False}
    base.update(kw)
    return argparse.Namespace(**base)


def test_dev_socket_path_default(monkeypatch, tmp_path):
    monkeypatch.delenv("HMS_DEV_SOCK", raising=False)
    monkeypatch.setattr("server.lib.upstream_paths.hms_run_dir", lambda: tmp_path)
    assert cli._dev_socket_path() == str(tmp_path / "station-dev.sock")


def test_dev_socket_path_env_override(monkeypatch):
    monkeypatch.setenv("HMS_DEV_SOCK", "/tmp/custom.sock")
    assert cli._dev_socket_path() == "/tmp/custom.sock"


def test_resolve_bind_explicit_port_is_tcp(monkeypatch):
    monkeypatch.delenv("HMS_DEV_SOCK", raising=False)
    monkeypatch.setattr("server.lib.config_reader.hms_host", lambda: "127.0.0.1")
    assert cli._resolve_dev_bind(_args(port=3140)) == {"host": "127.0.0.1", "port": 3140}


def test_resolve_bind_default_is_socket(monkeypatch, tmp_path):
    monkeypatch.delenv("HMS_DEV_SOCK", raising=False)
    monkeypatch.delenv("HMS_PORT", raising=False)
    monkeypatch.setattr("server.lib.upstream_paths.hms_run_dir", lambda: tmp_path)
    assert cli._resolve_dev_bind(_args()) == {"path": str(tmp_path / "station-dev.sock")}


def test_resolve_bind_sock_env(monkeypatch):
    monkeypatch.setenv("HMS_DEV_SOCK", "/tmp/x.sock")
    assert cli._resolve_dev_bind(_args()) == {"path": "/tmp/x.sock"}


def test_resolve_bind_port_env(monkeypatch):
    monkeypatch.delenv("HMS_DEV_SOCK", raising=False)
    monkeypatch.setenv("HMS_PORT", "3150")
    monkeypatch.setattr("server.lib.config_reader.hms_host", lambda: "127.0.0.1")
    assert cli._resolve_dev_bind(_args()) == {"host": "127.0.0.1", "port": 3150}


def test_cmd_dev_bare_execs_dev_stack(monkeypatch):
    monkeypatch.delenv("HMS_DEV_SOCK", raising=False)
    monkeypatch.delenv("HMS_PORT", raising=False)
    seen = {}

    def fake_exec(file, argv):
        seen["file"], seen["argv"] = file, argv
        raise SystemExit(0)  # exec would replace the process; simulate that

    monkeypatch.setattr(cli.os, "execvp", fake_exec)
    with pytest.raises(SystemExit):
        cli._cmd_dev(_args())
    assert seen["file"] == "bash"
    assert seen["argv"][0] == "bash"
    assert seen["argv"][1].endswith("scripts/dev.sh")


def test_cmd_dev_reload_runs_socket_backend(monkeypatch, tmp_path):
    monkeypatch.delenv("HMS_DEV_SOCK", raising=False)
    monkeypatch.delenv("HMS_PORT", raising=False)
    monkeypatch.setattr("server.lib.upstream_paths.hms_run_dir", lambda: tmp_path)
    monkeypatch.setattr(cli.os, "execvp", lambda *a: pytest.fail("should not exec"))
    seen = {}
    monkeypatch.setattr(cli, "_run_with_reload", lambda bind: seen.update(bind=bind))
    cli._cmd_dev(_args(reload=True))
    assert seen["bind"] == {"path": str(tmp_path / "station-dev.sock")}


def test_run_with_reload_degrades_when_watchdog_missing(monkeypatch):
    # A rebuilt host venv can drop Station's dev extras (watchdog). The reload
    # path must then fall back to a plain bind — NOT sys.exit — so the dev
    # socket still comes up and the Vite proxy never sees `ENOENT …dev.sock`.
    import sys as _sys

    # A None entry in sys.modules forces ImportError on the `import watchdog…`.
    monkeypatch.setitem(_sys.modules, "watchdog", None)
    monkeypatch.setitem(_sys.modules, "watchdog.observers", None)
    monkeypatch.setitem(_sys.modules, "watchdog.events", None)
    seen = {}
    monkeypatch.setattr(cli, "_run_once", lambda bind: seen.update(bind=bind))
    cli._run_with_reload({"path": "/tmp/x.sock"})  # must not raise SystemExit
    assert seen["bind"] == {"path": "/tmp/x.sock"}


def test_cmd_dev_explicit_port_runs_tcp(monkeypatch):
    monkeypatch.delenv("HMS_DEV_SOCK", raising=False)
    monkeypatch.setattr("server.lib.config_reader.hms_host", lambda: "127.0.0.1")
    monkeypatch.setattr(cli.os, "execvp", lambda *a: pytest.fail("should not exec"))
    seen = {}
    monkeypatch.setattr(cli, "_run_once", lambda bind: seen.update(bind=bind))
    cli._cmd_dev(_args(port=3140))
    assert seen["bind"] == {"host": "127.0.0.1", "port": 3140}
