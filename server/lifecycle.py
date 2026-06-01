"""Gateway lifecycle — install/start/stop/restart of the upstream hermes gateway service."""

from __future__ import annotations

import logging
import os
from typing import Any

from server.lib.plugin_install import (  # noqa: F401
    ENABLED_PATH,
    PLATFORM_PATH,
    PluginStatus,
    disable_in_config,
    enable_in_config,
    get_plugin_status,
    install_plugin,
    plugin_link_path,
    plugin_repo_root,
    purge_from_config,
    remove_symlink,
    symlink_plugin,
    uninstall_plugin,
)
from server.lib.upstream_paths import is_linux, is_macos
from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)


def request_gateway_self_restart() -> dict[str, Any]:
    """SIGUSR1 the gateway for graceful reload.

    Returns not_ancestor when launchd/systemd owns the PID.
    """
    find_gateway_pids = shim.gateway.find_gateway_pids
    _request_gateway_self_restart = shim.gateway.request_self_restart
    if find_gateway_pids is None or _request_gateway_self_restart is None:
        return {"ok": False, "reason": "upstream_unavailable", "pids": []}

    pids = find_gateway_pids()
    if not pids:
        return {"ok": False, "reason": "not_running", "pids": []}
    sent = []
    for pid in pids:
        if _request_gateway_self_restart(pid):
            sent.append(pid)
    if sent:
        return {"ok": True, "reason": "signalled",
                "pids_signalled": sent, "pids_found": list(pids)}
    # Upstream checks getppid recursively; SIGUSR1 fails when launchd/systemd owns the PID.
    return {"ok": False, "reason": "not_ancestor",
            "pids_signalled": [], "pids_found": list(pids)}


def spawn_hermes_gateway_restart() -> dict[str, Any]:
    """Spawn `hermes gateway restart` as a detached subprocess.

    The only honest restart for a launchd-owned gateway.
    """
    import subprocess
    from pathlib import Path

    from server.lib.upstream_paths import hermes_executable, hermes_home

    log_dir = hermes_home() / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        import tempfile
        log_dir = Path(tempfile.gettempdir())
    log_path = log_dir / "station-gateway-restart.log"

    exe = hermes_executable()
    # exe may be a single path or a space-separated python -m fallback.
    import shlex
    prefix = shlex.split(exe) if " " in exe else [exe]
    # Restart under the active profile so the gateway comes back up on the right
    # HERMES_HOME (mirrors spawn_profile_gateway's -p). Without this, upstream
    # warns "HERMES_HOME unset but active profile is X" and writes to ~/.hermes.
    # Default / unset profile → plain `gateway restart` (unchanged).
    from server.lib.profile_run import active_profile_name
    active = active_profile_name()
    if active:
        argv = [*prefix, "-p", active, "gateway", "restart"]
    else:
        argv = [*prefix, "gateway", "restart"]

    env = dict(os.environ)
    env.setdefault("HERMES_NONINTERACTIVE", "1")
    if active:
        # -p sets HERMES_HOME from argv; drop any inherited override so it wins.
        env.pop("HERMES_HOME", None)
    try:
        log_handle = log_path.open("ab")
    except OSError:
        log_handle = subprocess.DEVNULL  # type: ignore[assignment]

    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env=env,
        )
    except Exception as exc:
        if not isinstance(log_handle, int):
            log_handle.close()
        logger.exception("[hms.lifecycle] spawn gateway restart failed")
        return {"ok": False, "reason": "spawn_failed", "error": str(exc)}

    if not isinstance(log_handle, int):
        log_handle.close()

    return {"ok": True, "reason": "spawned",
            "pid": proc.pid, "log": str(log_path)}


def spawn_profile_gateway(profile: str, action: str) -> dict[str, Any]:
    """Spawn `hermes -p <profile> gateway <start|stop>` as a detached process.

    Per-profile gateways are separate services (upstream's multi-gateway
    model). The CLI's ``-p`` flag sets that profile's HERMES_HOME before the
    service command runs, so this is the honest cross-profile control.
    """
    import shlex
    import subprocess
    from pathlib import Path

    from server.lib.upstream_paths import hermes_executable, hermes_home

    if action not in ("start", "stop"):
        return {"ok": False, "reason": "invalid_action"}

    log_dir = hermes_home() / "logs"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        import tempfile
        log_dir = Path(tempfile.gettempdir())
    log_path = log_dir / f"station-gateway-{action}.log"

    exe = hermes_executable()
    prefix = shlex.split(exe) if " " in exe else [exe]
    argv = [*prefix, "-p", profile, "gateway", action]

    env = dict(os.environ)
    env.setdefault("HERMES_NONINTERACTIVE", "1")
    # -p sets HERMES_HOME from argv; drop any inherited override so it wins.
    env.pop("HERMES_HOME", None)
    try:
        log_handle = log_path.open("ab")
    except OSError:
        log_handle = subprocess.DEVNULL  # type: ignore[assignment]

    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env=env,
        )
    except Exception as exc:
        if not isinstance(log_handle, int):
            log_handle.close()
        logger.exception("[hms.lifecycle] spawn gateway %s for %r failed", action, profile)
        return {"ok": False, "reason": "spawn_failed", "error": str(exc)}

    if not isinstance(log_handle, int):
        log_handle.close()
    return {"ok": True, "reason": "spawned", "pid": proc.pid, "log": str(log_path)}


def start_gateway() -> dict[str, Any]:
    get_gateway_runtime_snapshot = shim.gateway.get_runtime_snapshot
    launchd_start = shim.gateway.launchd_start
    systemd_start = shim.gateway.systemd_start
    if get_gateway_runtime_snapshot is None:
        return {"ok": False, "reason": "upstream_unavailable"}
    snap = get_gateway_runtime_snapshot()
    if not snap.service_installed:
        return {"ok": False, "reason": "not_installed",
                "hint": "run `hermes gateway install` first"}
    if snap.service_running:
        return {"ok": True, "reason": "already_running",
                "pids": list(snap.gateway_pids)}
    try:
        if is_macos():
            if launchd_start is None:
                return {"ok": False, "reason": "upstream_unavailable"}
            launchd_start()
        elif is_linux():
            if systemd_start is None:
                return {"ok": False, "reason": "upstream_unavailable"}
            systemd_start()
        else:
            return {"ok": False, "reason": "unsupported_platform"}
    except SystemExit as exc:
        return {"ok": False, "reason": "service_command_failed", "exit_code": exc.code}
    except Exception as exc:
        logger.exception("[hms.lifecycle] start_gateway failed")
        return {"ok": False, "reason": str(exc)}
    return {"ok": True, "reason": "started"}


def stop_gateway() -> dict[str, Any]:
    get_gateway_runtime_snapshot = shim.gateway.get_runtime_snapshot
    launchd_stop = shim.gateway.launchd_stop
    systemd_stop = shim.gateway.systemd_stop
    if get_gateway_runtime_snapshot is None:
        return {"ok": False, "reason": "upstream_unavailable"}
    snap = get_gateway_runtime_snapshot()
    if not snap.service_installed and not snap.service_running:
        return {"ok": True, "reason": "already_stopped"}
    try:
        if is_macos():
            if launchd_stop is None:
                return {"ok": False, "reason": "upstream_unavailable"}
            launchd_stop()
        elif is_linux():
            if systemd_stop is None:
                return {"ok": False, "reason": "upstream_unavailable"}
            systemd_stop()
        else:
            return {"ok": False, "reason": "unsupported_platform"}
    except SystemExit as exc:
        return {"ok": False, "reason": "service_command_failed", "exit_code": exc.code}
    except Exception as exc:
        logger.exception("[hms.lifecycle] stop_gateway failed")
        return {"ok": False, "reason": str(exc)}
    return {"ok": True, "reason": "stopped"}


def restart_gateway() -> dict[str, Any]:
    """Synchronous service-manager restart — what `hermes gateway restart` does.

    Upstream's launchd_restart / systemd_restart try a graceful SIGUSR1 first,
    then terminate + kickstart, and print their own "✓ Service restarted". Safe
    from the `hms` CLI (a separate process); the REST endpoint must NOT use this
    (it runs inside the gateway and would kill itself) — it spawns detached.
    """
    get_snapshot = shim.gateway.get_runtime_snapshot
    launchd_restart = shim.gateway.launchd_restart
    systemd_restart = shim.gateway.systemd_restart
    if get_snapshot is None:
        return {"ok": False, "reason": "upstream_unavailable"}
    snap = get_snapshot()
    if not snap.service_installed:
        return {"ok": False, "reason": "not_installed",
                "hint": "run `hermes gateway install` first"}
    try:
        if is_macos():
            if launchd_restart is None:
                return {"ok": False, "reason": "upstream_unavailable"}
            launchd_restart()
        elif is_linux():
            if systemd_restart is None:
                return {"ok": False, "reason": "upstream_unavailable"}
            systemd_restart()
        else:
            return {"ok": False, "reason": "unsupported_platform"}
    except SystemExit as exc:
        return {"ok": False, "reason": "service_command_failed", "exit_code": exc.code}
    except Exception as exc:
        logger.exception("[hms.lifecycle] restart_gateway failed")
        return {"ok": False, "reason": str(exc)}
    return {"ok": True, "reason": "restarted"}


def get_gateway_status() -> dict[str, Any]:
    """live_pids defaults to [] — the SPA's restart-PID dance spins forever on None."""
    find_gateway_pids = shim.gateway.find_gateway_pids
    get_gateway_runtime_snapshot = shim.gateway.get_runtime_snapshot
    if get_gateway_runtime_snapshot is None:
        return {"manager": "unknown", "error": "upstream_unavailable", "live_pids": []}
    try:
        snap = get_gateway_runtime_snapshot()
        return {
            "manager": snap.manager,
            "service_installed": snap.service_installed,
            "service_running": snap.service_running,
            "service_scope": snap.service_scope,
            "live_pids": list((find_gateway_pids and find_gateway_pids()) or []),
        }
    except Exception as exc:
        logger.warning("[hms.lifecycle] gateway status probe failed: %s", exc)
        return {"manager": "unknown", "error": str(exc), "live_pids": []}


def platform_label() -> str:
    if is_macos():
        return "launchd"
    if is_linux():
        return "systemd"
    return os.name or "unknown"
