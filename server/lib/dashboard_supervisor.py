"""Station-owned Dashboard process supervisor.

Upstream Hermes Dashboard cannot self-start/stop, so station lifecycles it.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shlex
import signal
import time
from collections import deque
from pathlib import Path
from typing import Any

from server.lib import config_reader
from server.lib.upstream_paths import hermes_executable, hms_run_dir

logger = logging.getLogger(__name__)


PIDFILE_NAME = "station-dashboard.pid"
HEALTH_CHECK_INTERVAL_S = 10.0
HEALTH_CHECK_FAILURES_BEFORE_RESTART = 3
WINDOW_S = 60.0
MAX_CRASHES_PER_WINDOW = 5


def _pidfile_path() -> Path:
    return hms_run_dir() / PIDFILE_NAME


def _write_pidfile(pid: int) -> None:
    path = _pidfile_path()
    # fsync so a crash doesn't leave a torn file confusing the next boot's probe.
    with path.open("w", encoding="utf-8") as f:
        f.write(str(pid))
        f.flush()
        os.fsync(f.fileno())


def _read_pidfile() -> int | None:
    try:
        raw = _pidfile_path().read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None
    except OSError:
        return None
    try:
        pid = int(raw)
    except ValueError:
        return None
    return pid if pid > 0 else None


def _delete_pidfile() -> None:
    try:
        _pidfile_path().unlink()
    except FileNotFoundError:
        pass
    except OSError:
        logger.exception("[hms.dashboard] could not unlink pidfile")


def _process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        # Foreign uid — treat as "not ours" so we don't spawn a duplicate.
        return True
    except OSError:
        return False
    return True


def _build_spawn_argv() -> list[str]:
    exe = hermes_executable()
    prefix = shlex.split(exe) if " " in exe else [exe]
    url = config_reader.dashboard_url()
    host, port = _split_host_port(url, fallback_port=9119)  # hms-allow-hardcoding
    return [
        *prefix,
        "dashboard",
        "--no-open",
        "--host", host,
        "--port", str(port),
    ]


def _split_host_port(url: str, *, fallback_port: int) -> tuple[str, int]:
    rest = url.split("://", 1)[-1]
    netloc = rest.split("/", 1)[0]
    if ":" in netloc:
        host, _, p = netloc.rpartition(":")
        try:
            return (host or "127.0.0.1", int(p))
        except ValueError:
            return (host or "127.0.0.1", fallback_port)
    return (netloc or "127.0.0.1", fallback_port)


class DashboardSupervisor:
    """Single-instance dashboard lifecycle owner; idempotent ensure_running + crash-loop backoff."""

    def __init__(self, *, interval_s: float = HEALTH_CHECK_INTERVAL_S):
        self._interval_s = interval_s
        self._crash_log: deque[float] = deque()
        self._state: str = "stopped"
        self._last_error: str | None = None
        self._started_at: float | None = None
        self._spawned_by_us: bool = False
        self._lock = asyncio.Lock()

    async def ensure_running(self) -> bool:
        async with self._lock:
            if self._state == "crashed":
                return False
            existing = _read_pidfile()
            if existing is not None and _process_alive(existing):
                if self._state != "running":
                    self._state = "running"
                    self._started_at = self._started_at or time.time()
                return True
            try:
                self._spawn_locked()
                return True
            except Exception as exc:
                self._last_error = str(exc)
                logger.exception("[hms.dashboard] spawn failed")
                self._record_crash()
                return False

    async def watchdog(self) -> None:
        logger.info(
            "[hms.dashboard] watchdog started (interval=%.0fs, restart_after=%d failures)",
            self._interval_s, HEALTH_CHECK_FAILURES_BEFORE_RESTART,
        )
        consecutive_failures = 0
        try:
            while True:
                await asyncio.sleep(self._interval_s)
                if self._state == "crashed":
                    continue
                healthy = await self._probe_health()
                if healthy:
                    consecutive_failures = 0
                    continue
                consecutive_failures += 1
                logger.warning(
                    "[hms.dashboard] health check failed (%d/%d)",
                    consecutive_failures, HEALTH_CHECK_FAILURES_BEFORE_RESTART,
                )
                if consecutive_failures >= HEALTH_CHECK_FAILURES_BEFORE_RESTART:
                    consecutive_failures = 0
                    await self._kill_and_respawn()
        except asyncio.CancelledError:
            logger.info("[hms.dashboard] watchdog cancelled")
            raise

    async def terminate(self) -> None:
        """SIGTERM, 5s grace, then SIGKILL; never kills a pid we didn't spawn."""
        async with self._lock:
            pid = _read_pidfile()
            self._state = "stopped"
            if pid is None or not _process_alive(pid):
                _delete_pidfile()
                return
            if not self._spawned_by_us:
                logger.info(
                    "[hms.dashboard] leaving foreign pid %d untouched on shutdown",
                    pid,
                )
                return
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                _delete_pidfile()
                return
            except OSError as exc:
                logger.warning("[hms.dashboard] SIGTERM to %d failed: %s", pid, exc)

            for _ in range(50):
                await asyncio.sleep(0.1)
                if not _process_alive(pid):
                    break
            else:
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass

            _delete_pidfile()

    def snapshot(self) -> dict[str, Any]:
        pid = _read_pidfile()
        alive = pid is not None and _process_alive(pid)
        return {
            "state": "running" if alive and self._state == "running" else self._state,
            "pid": pid if alive else None,
            "managed_by_hms": self._spawned_by_us,
            "url": config_reader.dashboard_url(),
            "started_at": self._started_at if alive else None,
            "last_error": self._last_error,
            "recent_crashes": list(self._crash_log),
        }

    def _spawn_locked(self) -> None:
        import subprocess

        argv = _build_spawn_argv()
        logger.info("[hms.dashboard] spawning: %s", " ".join(argv))
        # start_new_session isolates the child PG so Ctrl-C to pnpm dev doesn't kill it.
        proc = subprocess.Popen(
            argv,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        _write_pidfile(proc.pid)
        self._spawned_by_us = True
        self._started_at = time.time()
        # Stay "starting" until the next probe succeeds — child may exit if port is taken.
        self._state = "starting"

    async def _probe_health(self) -> bool:
        url = config_reader.dashboard_url() + "/api/status"
        try:
            import aiohttp
            timeout = aiohttp.ClientTimeout(total=3.0)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as resp:
                    ok = resp.status < 400
                    if ok and self._state == "starting":
                        self._state = "running"
                        self._last_error = None
                    return ok
        except Exception as exc:
            self._last_error = f"{exc.__class__.__name__}: {exc}"
            return False

    async def _kill_and_respawn(self) -> None:
        async with self._lock:
            self._record_crash()
            if self._crash_loop_detected():
                self._state = "crashed"
                logger.error(
                    "[hms.dashboard] crash loop detected (%d in %ds); supervisor stopped",
                    MAX_CRASHES_PER_WINDOW, int(WINDOW_S),
                )
                return
            pid = _read_pidfile()
            if pid is not None and _process_alive(pid) and self._spawned_by_us:
                try:
                    os.kill(pid, signal.SIGTERM)
                except OSError:
                    pass
                for _ in range(20):
                    await asyncio.sleep(0.1)
                    if not _process_alive(pid):
                        break
                else:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except OSError:
                        pass
            _delete_pidfile()
            try:
                self._spawn_locked()
            except Exception:
                logger.exception("[hms.dashboard] respawn failed")
                self._state = "stopped"

    def _record_crash(self) -> None:
        now = time.time()
        self._crash_log.append(now)
        while self._crash_log and now - self._crash_log[0] > WINDOW_S:
            self._crash_log.popleft()

    def _crash_loop_detected(self) -> bool:
        return len(self._crash_log) >= MAX_CRASHES_PER_WINDOW
