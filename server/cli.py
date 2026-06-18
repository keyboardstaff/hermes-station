"""hms command-line entry point — install/uninstall/status/restart/dev."""

from __future__ import annotations

import argparse
import logging
import os
import signal
import subprocess
import sys
import threading
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from server import lifecycle

LOG_FORMAT = "[%(asctime)s] %(levelname)s %(name)s: %(message)s"


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(level=level, format=LOG_FORMAT, datefmt="%H:%M:%S")


def _patch_unix_keepalive() -> None:
    """Silence SO_KEEPALIVE errors on Unix-domain sockets.

    aiohttp unconditionally calls tcp_keepalive() in connection_made(), but
    macOS does not support SO_KEEPALIVE on AF_UNIX sockets and raises
    OSError: [Errno 22] Invalid argument for every incoming connection.
    This patches aiohttp.tcp_helpers at runtime to skip the setsockopt call
    when the socket is AF_UNIX, leaving TCP sockets unaffected.
    """
    import socket as _socket

    try:
        import aiohttp.tcp_helpers as _th
    except ImportError:
        return

    if getattr(_th, "_unix_keepalive_patched", False):
        return

    _orig = _th.tcp_keepalive

    def _patched(transport: Any) -> None:
        sock = transport.get_extra_info("socket")
        if sock is not None and getattr(sock, "family", None) == _socket.AF_UNIX:
            return  # SO_KEEPALIVE is not supported on Unix domain sockets (macOS)
        _orig(transport)

    _th.tcp_keepalive = _patched
    _th._unix_keepalive_patched = True  # type: ignore[attr-defined]


def _run_once(bind: dict[str, Any]) -> None:
    from aiohttp import web

    from server.app import build_app

    if "path" in bind:
        # macOS raises EINVAL when aiohttp sets SO_KEEPALIVE on a Unix socket.
        _patch_unix_keepalive()

    app = build_app(adapter=None)
    if "path" in bind:
        _ensure_socket_free(bind["path"])
        web.run_app(app, path=bind["path"], print=None)  # type: ignore[arg-type]
    else:
        web.run_app(app, host=bind["host"], port=bind["port"], print=None)  # type: ignore[arg-type]


def _ensure_socket_free(path: str) -> None:
    """Refuse to clobber a live dev socket; unlink a stale one left by a crash."""
    import socket as _socket

    p = Path(path)
    if not p.exists():
        return
    probe = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
    try:
        probe.settimeout(0.5)
        live = probe.connect_ex(str(p)) == 0
    finally:
        probe.close()
    if live:
        print(f"✗ a dev backend is already listening on {path}", file=sys.stderr)
        sys.exit(1)
    p.unlink(missing_ok=True)


def _run_with_reload(bind: dict[str, Any]) -> None:
    try:
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
    except ImportError:
        # Hot reload is a dev convenience, not a hard requirement. A missing
        # watchdog must NOT take the backend down — exiting here strands the
        # Vite proxy on an unbound socket (the opaque
        # `connect ENOENT …/station-dev.sock` you get when a dev dep is absent,
        # e.g. after the host venv is rebuilt). Degrade to one no-reload run so
        # the socket still binds; tell the operator how to restore live reload.
        print(
            "⚠ watchdog not installed — serving without hot reload "
            "(restore with: pip install -e '.[dev]'). Source edits need a "
            "manual restart.",
            file=sys.stderr,
            flush=True,
        )
        _run_once(bind)
        return

    pkg_dir = Path(__file__).resolve().parent

    def _spawn() -> subprocess.Popen[Any]:
        env = os.environ.copy()
        # Run the dev backend under the active profile's HERMES_HOME, else
        # upstream warns it's falling back to ~/.hermes and writes to the wrong
        # profile. The dev socket stays pinned via HMS_DEV_SOCK below, so this
        # only moves the *data* home — not where Vite proxies.
        if "HERMES_HOME" not in env:
            from server.lib.profile_run import active_profile_home
            _home = active_profile_home()
            if _home is not None:
                env["HERMES_HOME"] = str(_home)
        if "path" in bind:
            env["HMS_DEV_SOCK"] = bind["path"]
            env.pop("HMS_PORT", None)
        else:
            env["HMS_HOST"] = bind["host"]
            env["HMS_PORT"] = str(bind["port"])
            env.pop("HMS_DEV_SOCK", None)
        return subprocess.Popen(
            [sys.executable, "-m", "server", "dev", "--_inner"],
            env=env,
        )

    child = [_spawn()]
    restart_lock = threading.Lock()
    pending_restart = [False]

    class Handler(FileSystemEventHandler):  # type: ignore[misc]
        def on_any_event(self, event: Any) -> None:
            if not event.src_path.endswith(".py"):
                return
            with restart_lock:
                pending_restart[0] = True

    observer = Observer()
    observer.schedule(Handler(), str(pkg_dir), recursive=True)
    observer.start()

    def _shutdown(*_args: Any) -> None:
        observer.stop()
        if child[0].poll() is None:
            child[0].terminate()
            try:
                child[0].wait(timeout=5)
            except subprocess.TimeoutExpired:
                child[0].kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    try:
        while True:
            time.sleep(0.5)
            with restart_lock:
                if pending_restart[0]:
                    pending_restart[0] = False
                    print("[hms dev] server/ changed — restarting", file=sys.stderr)
                    if child[0].poll() is None:
                        child[0].terminate()
                        try:
                            child[0].wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            child[0].kill()
                    child[0] = _spawn()
            if child[0].poll() is not None and not pending_restart[0]:
                code = child[0].returncode
                observer.stop()
                sys.exit(code)
    finally:
        observer.join()


def _cmd_install(args: argparse.Namespace) -> int:
    try:
        report = lifecycle.install_plugin(force=args.force)
    except Exception as exc:
        print(f"✗ install failed: {exc}", file=sys.stderr)
        return 1
    for entry in report["files"]:
        print(f"  {entry['action']:8} {entry['name']}")
    print(f"  config patched: {report['config_patched']}")
    status = lifecycle.get_plugin_status()
    print()
    print(f"✓ plugin files at {status.plugin_link_dir} → {status.plugin_dir}")
    if not status.config_enabled:
        print("⚠ platforms.station not enabled in config.yaml")
        return 2
    print()
    print("Next step: enable autostart for the gateway service if you")
    print("haven't already:")
    print(f"  hermes gateway install     # registers {lifecycle.platform_label()} service")
    print()
    print("Then either start the gateway (`hermes gateway start`) or, if")
    print("it's already running, force a reload to pick up the plugin:")
    print("  hms restart")
    return 0


def _cmd_uninstall(args: argparse.Namespace) -> int:
    report = lifecycle.uninstall_plugin()
    print(f"  action: {report['action']}")
    for name in report.get("files", []):
        print(f"  removed: {name}")

    if args.keep_config:
        config_purged = False
    else:
        try:
            config_purged = lifecycle.purge_from_config()
        except Exception as exc:
            print(f"⚠ failed to purge config.yaml station section: {exc}",
                  file=sys.stderr)
            config_purged = False
    print(f"  config purged: {config_purged}")
    print()
    if args.keep_config:
        print("config.yaml left intact (per --keep-config). Remove the")
        print("``platforms.station`` section by hand or re-run")
        print("without the flag for a clean rollback.")
    else:
        print("Station plugin layer fully removed. The gateway service")
        print("itself (launchd/systemd unit) belongs to hermes-agent — run")
        print("  hermes gateway uninstall")
        print("if you also want to drop the autostart unit.")
    return 0


def _cmd_status(_args: argparse.Namespace) -> int:
    ps = lifecycle.get_plugin_status()
    print("Plugin:")
    print(f"  repo:         {ps.plugin_dir}")
    print(f"  install dir:  {ps.plugin_link_dir}  {'✓' if ps.files_installed else '✗'}")
    print(f"  config:       {'✓ enabled' if ps.config_enabled else '✗ disabled'}")
    if not ps.config_present:
        print("                (config.yaml does not exist)")
    print()
    print("Gateway:")
    gs = lifecycle.get_gateway_status()
    print(f"  manager:      {gs.get('manager')}")
    print(f"  service:      installed={gs.get('service_installed')} "
          f"running={gs.get('service_running')}")
    pids = gs.get("live_pids") or []
    print(f"  live pids:    {pids or '(none)'}")
    if gs.get("error"):
        print(f"  error:        {gs['error']}")
    return 0


def _cmd_restart(_args: argparse.Namespace) -> int:
    # In-process service-manager restart (symmetric with `hms start` / `hms stop`);
    # upstream prints its own "✓ Service restarted". Routing this through
    # `hermes -p <profile> gateway restart` to fix the active-profile home tripped
    # upstream's "refusing to restart from inside the gateway" loop-guard, so we
    # keep the direct restart: which HERMES_HOME the relaunched *service* uses is
    # the service plist's env (set at `gateway install`), not something a restart
    # can change (upstream issue #18594).
    out = lifecycle.restart_gateway()
    if out["ok"]:
        return 0
    reason = out.get("reason", "unknown")
    if reason == "not_installed":
        print(f"✗ {reason} — {out.get('hint', '')}")
    else:
        print(f"✗ restart failed: {reason}")
    return 1


def _cmd_start(_args: argparse.Namespace) -> int:
    out = lifecycle.start_gateway()
    reason = out.get("reason", "")
    if out["ok"]:
        if reason == "already_running":
            print(f"✓ already running (pids: {out.get('pids', [])})")
        else:
            print("✓ start requested")
        return 0
    if reason == "not_installed":
        print(f"✗ {reason} — {out.get('hint', '')}")
    else:
        print(f"✗ start failed: {reason}")
    return 1


def _cmd_stop(_args: argparse.Namespace) -> int:
    out = lifecycle.stop_gateway()
    reason = out.get("reason", "")
    if out["ok"]:
        if reason == "already_stopped":
            print("✓ already stopped")
        else:
            print("✓ stop requested")
        return 0
    print(f"✗ stop failed: {reason}")
    return 1


def _dev_socket_path() -> str:
    """Unix socket the dev backend binds — no TCP port, so dev never collides
    with the production gateway (TCP) and the only open dev port is Vite's 3131.
    Override with the HMS_DEV_SOCK env var."""
    env = os.getenv("HMS_DEV_SOCK")
    if env:
        return env
    from server.lib.upstream_paths import hms_run_dir
    return str(hms_run_dir() / "station-dev.sock")


def _resolve_dev_bind(args: argparse.Namespace) -> dict[str, Any]:
    """Pick the dev backend transport. Explicit --port → TCP (escape hatch for
    direct access / smokes); a reload parent or dev.sh hands its choice down via
    HMS_DEV_SOCK / HMS_PORT; otherwise the default is a Unix socket."""
    if args.port is not None:
        from server.lib import config_reader
        return {"host": args.host or config_reader.hms_host(), "port": args.port}
    if os.getenv("HMS_DEV_SOCK"):
        return {"path": _dev_socket_path()}
    port_env = os.getenv("HMS_PORT")
    if port_env and port_env.isdigit():
        from server.lib import config_reader
        return {"host": args.host or config_reader.hms_host(), "port": int(port_env)}
    return {"path": _dev_socket_path()}


def _cmd_dev(args: argparse.Namespace) -> int:
    _configure_logging(getattr(args, "verbose", False))

    # Bare `hms dev` is an alias for the full `pnpm dev` stack: Vite HMR on
    # :3131 + the backend behind it. dev.sh re-enters this command as
    # `python -m server dev --reload`, which carries --reload and so takes the
    # backend path below — no recursion, no extra state needed. Pass any flag
    # (`--reload` / `--port` / `--host`), or set HMS_DEV_SOCK / HMS_PORT, to run
    # *just* the backend instead.
    is_bare = (
        not getattr(args, "_inner", False)
        and not args.reload
        and args.port is None
        and args.host is None
        and not os.getenv("HMS_DEV_SOCK")
        and not os.getenv("HMS_PORT")
    )
    if is_bare:
        dev_script = Path(__file__).resolve().parent.parent / "scripts" / "dev.sh"
        if dev_script.is_file():
            os.execvp("bash", ["bash", str(dev_script)])  # noqa: S606 — controlled repo script
        # Not a source checkout (installed plugin) — fall through to backend-only.

    bind = _resolve_dev_bind(args)
    # Pin the chosen transport into the env so in-process Station code and the
    # reload child agree with what we actually bound.
    if "port" in bind:
        os.environ["HMS_PORT"] = str(bind["port"])
        os.environ.pop("HMS_DEV_SOCK", None)
    else:
        os.environ["HMS_DEV_SOCK"] = bind["path"]
        os.environ.pop("HMS_PORT", None)

    # aiohttp's own "Running on …" banner is suppressed (print=None), so print
    # where we bound ourselves. Only the parent prints; the child stays quiet.
    if not getattr(args, "_inner", False):
        if "port" in bind:
            open_host = "127.0.0.1" if bind["host"] in ("0.0.0.0", "::") else bind["host"]  # noqa: S104
            print(f"→ Station backend on http://{open_host}:{bind['port']}/", flush=True)
        else:
            print(f"→ Station backend on unix:{bind['path']}", flush=True)

    if args.reload and not getattr(args, "_inner", False):
        _run_with_reload(bind)
    else:
        _run_once(bind)
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="hms",
        description="Hermes Station plugin admin CLI",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_install = sub.add_parser("install", help="symlink + enable in config.yaml")
    p_install.add_argument("--force", action="store_true",
                           help="replace an existing symlink target")
    p_install.set_defaults(func=_cmd_install)

    p_un = sub.add_parser("uninstall", help="remove the plugin symlink + config section")
    p_un.add_argument("--keep-config", action="store_true",
                      help="leave the station section in config.yaml intact")
    p_un.set_defaults(func=_cmd_uninstall)

    p_st = sub.add_parser("status", help="show plugin + gateway state")
    p_st.set_defaults(func=_cmd_status)

    p_rs = sub.add_parser("restart", help="ask the gateway to reload (SIGUSR1)")
    p_rs.set_defaults(func=_cmd_restart)

    p_start = sub.add_parser("start", help="start the gateway service (launchd/systemd)")
    p_start.set_defaults(func=_cmd_start)

    p_stop = sub.add_parser("stop", help="stop the gateway service (launchd/systemd)")
    p_stop.set_defaults(func=_cmd_stop)

    p_dev = sub.add_parser(
        "dev", help="alias for `pnpm dev` (Vite HMR :3131 + backend); flags run backend-only"
    )
    p_dev.add_argument("--host", help="bind host override")
    p_dev.add_argument("--port", type=int, help="bind port override")
    p_dev.add_argument("--reload", action="store_true",
                       help="watchdog reload on source changes")
    p_dev.add_argument("--verbose", "-v", action="store_true")
    p_dev.add_argument("--_inner", action="store_true", help=argparse.SUPPRESS)
    p_dev.set_defaults(func=_cmd_dev)

    return ap


def main(argv: Sequence[str] | None = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    rc = args.func(args)
    return rc if isinstance(rc, int) else 0


if __name__ == "__main__":
    sys.exit(main())
