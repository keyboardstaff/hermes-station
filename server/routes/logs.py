"""Log tailing — SSE follow (text/event-stream) or one-shot JSON snapshot via ?tail=N."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import deque
from pathlib import Path

from aiohttp import web

from server.lib.upstream_paths import hermes_home

logger = logging.getLogger(__name__)

router = web.RouteTableDef()


_TAIL_BYTES_DEFAULT = 32 * 1024
_POLL_INTERVAL_SECONDS = 1.0
_HEARTBEAT_SECONDS = 25.0

_DEFAULT_LINE_COUNT = 200
_MAX_LINE_COUNT = 10_000


def _real_logs() -> dict[str, Path]:
    home = hermes_home()
    return {
        "agent":   home / "logs" / "agent.log",
        "errors":  home / "logs" / "errors.log",
        "gateway": home / "logs" / "gateway.log",
    }


def _component_prefixes() -> dict[str, tuple[str, ...]]:
    """Source of truth is hermes_logging.COMPONENT_PREFIXES; falls back to {} on import failure."""
    try:
        from hermes_logging import COMPONENT_PREFIXES  # type: ignore[import-not-found]
        return {k: tuple(v) for k, v in COMPONENT_PREFIXES.items()}
    except Exception:
        return {}


# Anchored on the logger-name field so filter on "tools.terminal_command"
# doesn't match random "tools" mentions inside the message body.
_LOG_LINE_RE = re.compile(
    r"""^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[.,]?\d*\s+"""
    r"""(?P<level>[A-Z]+)\s+"""
    r"""(?P<logger>[\w.\-]+)\s*:"""
)


def _line_logger(line: str) -> str:
    m = _LOG_LINE_RE.match(line)
    return m.group("logger") if m else ""


def _line_level(line: str) -> str:
    m = _LOG_LINE_RE.match(line)
    return m.group("level") if m else ""


def _component_matches(prefixes: tuple[str, ...], line: str) -> bool:
    if not prefixes:
        return True
    logger_name = _line_logger(line)
    if not logger_name:
        return False
    for p in prefixes:
        if logger_name == p or logger_name.startswith(p + "."):
            return True
    return False


def _level_matches(level: str, line: str) -> bool:
    if not level or level == "ALL":
        return True
    parsed = _line_level(line)
    return parsed.upper() == level.upper()


def _resolve_source(file_name: str, component: str | None) -> dict | None:
    real = _real_logs()
    if file_name == "all":
        paths = list(real.values())
    elif file_name in real:
        paths = [real[file_name]]
    else:
        return None

    prefixes: tuple[str, ...] = ()
    if component and component != "all":
        comp_map = _component_prefixes()
        comp_value = comp_map.get(component)
        if comp_value is None:
            return None
        prefixes = comp_value
    return {"paths": paths, "prefixes": prefixes}


def _read_tail_bytes(path: Path, max_bytes: int) -> str:
    if not path.exists():
        return ""
    try:
        size = path.stat().st_size
        start = max(0, size - max_bytes)
        with path.open("rb") as fh:
            if start > 0:
                fh.seek(start)
                # Skip the partial first line so we don't render half a record.
                fh.readline()
            return fh.read().decode("utf-8", errors="replace")
    except Exception:
        logger.exception("[hms.logs] tail read failed for %s", path)
        return ""


def _read_tail_lines(path: Path, n: int) -> list[str]:
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            buf: deque[str] = deque(maxlen=n)
            for line in fh:
                buf.append(line.rstrip("\n"))
            return list(buf)
    except Exception:
        logger.exception("[hms.logs] line tail failed for %s", path)
        return []


def _gather_lines(source: dict, n: int, level: str = "ALL") -> list[str]:
    """Read 10× cap when filters are active to keep post-filter results close to n."""
    prefixes = source.get("prefixes", ())
    paths = source["paths"]
    multiplier = 10 if (prefixes or level not in ("", "ALL")) else 1
    per_file = min(max(1, n * multiplier // len(paths)), _MAX_LINE_COUNT)

    chunks: list[str] = []
    for p in paths:
        chunks.extend(_read_tail_lines(p, per_file))

    filtered = [
        ln for ln in chunks
        if _component_matches(prefixes, ln) and _level_matches(level, ln)
    ]
    return filtered[-n:]


@router.get("/api/fs/logs/{file}")
async def stream_or_tail_logs(request: web.Request) -> web.StreamResponse:
    name = request.match_info.get("file", "")
    component = request.query.get("component") or "all"
    level = (request.query.get("level") or "ALL").upper()
    source = _resolve_source(name, component)
    if source is None:
        return web.json_response({"error": "unknown_log"}, status=400)

    tail = request.query.get("tail") or request.query.get("lines")
    accept = request.headers.get("Accept", "")
    if tail is not None:
        try:
            n = max(1, min(_MAX_LINE_COUNT, int(tail)))
        except (TypeError, ValueError):
            n = _DEFAULT_LINE_COUNT
        return web.json_response({"lines": _gather_lines(source, n, level)})

    if "text/event-stream" not in accept:
        if "application/json" in accept:
            return web.json_response(
                {"lines": _gather_lines(source, _DEFAULT_LINE_COUNT, level)}
            )

    return await _sse_stream(request, source, level)


async def _sse_stream(
    request: web.Request, source: dict, level: str = "ALL",
) -> web.StreamResponse:
    """For multi-file sources, follow the most-recently-modified file."""
    paths = source["paths"]
    prefixes = source.get("prefixes", ())
    if len(paths) > 1:
        try:
            primary = max(paths, key=lambda p: p.stat().st_mtime if p.exists() else 0)
        except Exception:
            primary = paths[0]
    else:
        primary = paths[0]

    resp = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
    await resp.prepare(request)

    async def _send(chunk: str) -> None:
        if prefixes or level not in ("", "ALL"):
            kept = [
                ln for ln in chunk.split("\n")
                if _component_matches(prefixes, ln) and _level_matches(level, ln)
            ]
            if not kept:
                return
            chunk = "\n".join(kept)
        payload = json.dumps(chunk)
        await resp.write(f"data: {payload}\n\n".encode())

    async def _heartbeat() -> None:
        await resp.write(b": heartbeat\n\n")

    initial = _read_tail_bytes(primary, _TAIL_BYTES_DEFAULT)
    if initial:
        await _send(initial)

    last_size = primary.stat().st_size if primary.exists() else 0
    last_inode = primary.stat().st_ino if primary.exists() else None
    last_heartbeat = 0.0

    try:
        loop = asyncio.get_running_loop()
        while not request.transport or not request.transport.is_closing():
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)
            if not primary.exists():
                last_size = 0
                continue
            st = primary.stat()
            rotated = last_inode is not None and st.st_ino != last_inode
            truncated = st.st_size < last_size
            if rotated or truncated:
                last_size = 0
                last_inode = st.st_ino
            if st.st_size > last_size:
                try:
                    with primary.open("rb") as fh:
                        fh.seek(last_size)
                        chunk = fh.read().decode("utf-8", errors="replace")
                    if chunk:
                        await _send(chunk)
                    last_size = st.st_size
                    last_inode = st.st_ino
                except Exception:
                    logger.exception("[hms.logs] sse poll read failed")
            now = loop.time()
            if now - last_heartbeat >= _HEARTBEAT_SECONDS:
                await _heartbeat()
                last_heartbeat = now
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    except Exception:
        logger.exception("[hms.logs] sse stream errored")
    finally:
        try:
            await resp.write_eof()
        except Exception:
            pass
    return resp


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
