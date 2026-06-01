"""Tests for the station-owned Dashboard supervisor."""

from __future__ import annotations

import asyncio
import os
import signal
from pathlib import Path
from unittest.mock import patch

import pytest
from server.lib import config_reader, dashboard_supervisor
from server.lib.dashboard_supervisor import (
    DashboardSupervisor,
    _pidfile_path,
    _read_pidfile,
    _split_host_port,
    _write_pidfile,
)


@pytest.fixture(autouse=True)
def _isolate_run_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "server.lib.dashboard_supervisor.hms_run_dir",
        lambda: tmp_path,
    )
    # Stub config_reader so we don't hit ~/.hermes/config.yaml.
    monkeypatch.setattr(config_reader, "_cached_doc", lambda: {})
    monkeypatch.setattr(config_reader, "_cached_extra", lambda: {})
    monkeypatch.delenv("HERMES_DASHBOARD_URL", raising=False)


class _StubProc:
    def __init__(self, pid: int = 99999):
        self.pid = pid


# pidfile helpers


def test_write_and_read_pidfile_round_trip() -> None:
    _write_pidfile(12345)
    assert _read_pidfile() == 12345


def test_read_pidfile_returns_none_when_missing() -> None:
    assert _read_pidfile() is None


def test_read_pidfile_returns_none_on_garbage() -> None:
    _pidfile_path().write_text("not-a-pid", encoding="utf-8")
    assert _read_pidfile() is None


# host/port parsing


@pytest.mark.parametrize("url,expected", [
    ("http://127.0.0.1:9119", ("127.0.0.1", 9119)),
    ("http://localhost:8080", ("localhost", 8080)),
    ("http://10.0.0.5:18119/", ("10.0.0.5", 18119)),
    ("https://example.test:443", ("example.test", 443)),
])
def test_split_host_port_extracts_components(url: str, expected: tuple) -> None:
    assert _split_host_port(url, fallback_port=9119) == expected


def test_split_host_port_uses_fallback_when_missing() -> None:
    assert _split_host_port("http://127.0.0.1", fallback_port=9119) == ("127.0.0.1", 9119)


# ensure_running


@pytest.mark.asyncio
async def test_ensure_running_spawns_when_no_pidfile() -> None:
    sup = DashboardSupervisor()
    stub = _StubProc(pid=11111)
    with patch("subprocess.Popen", return_value=stub) as popen, \
         patch.object(dashboard_supervisor, "_process_alive", return_value=True):
        ok = await sup.ensure_running()
    assert ok is True
    popen.assert_called_once()
    assert _read_pidfile() == 11111
    snap = sup.snapshot()
    assert snap["managed_by_hms"] is True


@pytest.mark.asyncio
async def test_ensure_running_is_idempotent_when_pidfile_alive() -> None:
    """If the pidfile points at a live PID, we must NOT spawn again."""
    _write_pidfile(22222)
    sup = DashboardSupervisor()
    with patch("subprocess.Popen") as popen, \
         patch.object(dashboard_supervisor, "_process_alive", return_value=True):
        ok = await sup.ensure_running()
    assert ok is True
    popen.assert_not_called()


@pytest.mark.asyncio
async def test_ensure_running_respawns_on_stale_pidfile() -> None:
    """Stale pidfile (pid dead) → spawn new process."""
    _write_pidfile(33333)  # dead pid
    sup = DashboardSupervisor()
    # _process_alive returns False for the stale pid, True after spawn.
    alive_returns = iter([False, True, True, True])
    with patch("subprocess.Popen", return_value=_StubProc(pid=44444)) as popen, \
         patch.object(dashboard_supervisor, "_process_alive",
                      side_effect=lambda *_: next(alive_returns, True)):
        ok = await sup.ensure_running()
    assert ok is True
    popen.assert_called_once()
    assert _read_pidfile() == 44444


@pytest.mark.asyncio
async def test_ensure_running_returns_false_in_crashed_state() -> None:
    sup = DashboardSupervisor()
    sup._state = "crashed"
    with patch("subprocess.Popen") as popen:
        ok = await sup.ensure_running()
    assert ok is False
    popen.assert_not_called()


# watchdog


@pytest.mark.asyncio
async def test_watchdog_restarts_after_threshold_failures() -> None:
    """3 consecutive failed probes → kill + respawn."""
    sup = DashboardSupervisor(interval_s=0.001)
    _write_pidfile(55555)
    sup._spawned_by_us = True
    sup._state = "running"

    respawn_count = [0]

    async def fail_probe() -> bool:
        return False

    async def fake_respawn() -> None:
        respawn_count[0] += 1
        # Stop the watchdog after the first restart so the test terminates.
        sup._state = "crashed"

    with patch.object(sup, "_probe_health", side_effect=fail_probe), \
         patch.object(sup, "_kill_and_respawn", side_effect=fake_respawn):
        task = asyncio.create_task(sup.watchdog())
        # Give the loop time to accumulate 3 failures + trigger respawn.
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert respawn_count[0] == 1


@pytest.mark.asyncio
async def test_watchdog_resets_counter_on_recovery() -> None:
    """A passing probe between failures must reset the counter."""
    sup = DashboardSupervisor(interval_s=0.001)
    _write_pidfile(66666)
    sup._spawned_by_us = True
    sup._state = "running"

    # Pattern: fail, fail, pass, fail, fail — must NOT respawn (only 2 in a row).
    pattern = iter([False, False, True, False, False] + [True] * 20)

    async def patterned_probe() -> bool:
        return next(pattern, True)

    respawn_count = [0]

    async def fake_respawn() -> None:
        respawn_count[0] += 1
        sup._state = "crashed"

    with patch.object(sup, "_probe_health", side_effect=patterned_probe), \
         patch.object(sup, "_kill_and_respawn", side_effect=fake_respawn):
        task = asyncio.create_task(sup.watchdog())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert respawn_count[0] == 0, "two non-consecutive failures must not trigger respawn"


# crash-loop detection


@pytest.mark.asyncio
async def test_crash_loop_flips_to_crashed_state() -> None:
    """≥ MAX_CRASHES_PER_WINDOW crashes inside the window → crashed."""
    sup = DashboardSupervisor()
    sup._spawned_by_us = True
    _write_pidfile(77777)

    # Patch every external side-effect: process kill, sleep, spawn.
    with patch.object(dashboard_supervisor, "_process_alive", return_value=False), \
         patch("os.kill"), \
         patch("subprocess.Popen", return_value=_StubProc(pid=77778)):
        for _ in range(dashboard_supervisor.MAX_CRASHES_PER_WINDOW):
            await sup._kill_and_respawn()

    assert sup._state == "crashed"
    # ensure_running must refuse once crashed.
    ok = await sup.ensure_running()
    assert ok is False


@pytest.mark.asyncio
async def test_crash_log_evicts_old_entries() -> None:
    """Crashes older than WINDOW_S must be discarded so a slow-burn."""
    sup = DashboardSupervisor()
    # Inject 4 ancient crashes that should be evicted on the next record.
    ancient = 1.0  # 1970-ish
    sup._crash_log.extend([ancient] * 4)
    sup._record_crash()
    # After the eviction, only the just-now timestamp survives.
    assert len(sup._crash_log) == 1
    assert sup._crash_log[0] > ancient


# terminate


@pytest.mark.asyncio
async def test_terminate_kills_managed_process_and_removes_pidfile() -> None:
    sup = DashboardSupervisor()
    sup._spawned_by_us = True
    _write_pidfile(88888)

    # SIGTERM → simulate clean exit by toggling _process_alive to False.
    alive_iter = iter([True, False])  # initial check, then dead after SIGTERM
    sent_signals: list[int] = []

    def fake_kill(_pid: int, sig: int) -> None:
        sent_signals.append(sig)

    with patch.object(dashboard_supervisor, "_process_alive",
                      side_effect=lambda *_: next(alive_iter, False)), \
         patch("os.kill", side_effect=fake_kill):
        await sup.terminate()
    assert signal.SIGTERM in sent_signals
    assert _read_pidfile() is None
    assert sup._state == "stopped"


@pytest.mark.asyncio
async def test_terminate_leaves_foreign_pid_untouched() -> None:
    """We must not SIGKILL a PID we didn't spawn (operator-owned)."""
    sup = DashboardSupervisor()
    sup._spawned_by_us = False  # foreign pid scenario
    _write_pidfile(99999)

    with patch.object(dashboard_supervisor, "_process_alive", return_value=True), \
         patch("os.kill") as kill_mock:
        await sup.terminate()
    kill_mock.assert_not_called()
    # We leave the pidfile alone too — the foreign owner manages it.
    assert _read_pidfile() == 99999


@pytest.mark.asyncio
async def test_terminate_when_no_process_is_noop() -> None:
    sup = DashboardSupervisor()
    sup._spawned_by_us = True
    # No pidfile written.
    with patch("os.kill") as kill_mock:
        await sup.terminate()
    kill_mock.assert_not_called()
    assert _read_pidfile() is None


# snapshot


def test_snapshot_includes_url_and_state_when_dead() -> None:
    sup = DashboardSupervisor()
    snap = sup.snapshot()
    assert snap["state"] == "stopped"
    assert snap["pid"] is None
    assert snap["url"].startswith("http://")


def test_snapshot_reflects_alive_pid() -> None:
    sup = DashboardSupervisor()
    sup._state = "running"
    sup._spawned_by_us = True
    _write_pidfile(os.getpid())  # use real live pid (ourselves)
    snap = sup.snapshot()
    assert snap["pid"] == os.getpid()
    assert snap["state"] == "running"
