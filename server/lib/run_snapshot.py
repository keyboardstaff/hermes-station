"""Crash recovery for in-flight chat turns.

The live turn is accumulated in memory on the ``RunHandle`` and replayed to a
re-attaching client — but a gateway crash kills that buffer. So while a run is
executing we checkpoint its partial answer to a small per-run sidecar; if the
process dies mid-turn the sidecar survives, and the session view surfaces the
partial as an *interrupted* message on the next load (we can't resume — the
agent worker thread is gone). A clean completion deletes its own sidecar (the
real message is now in ``state.db``), so any sidecar that outlives its run is,
by definition, a crash to recover.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

from server.lib.upstream_paths import run_snapshots_dir

logger = logging.getLogger(__name__)


def _path(run_id: str) -> Path:
    return run_snapshots_dir() / f"{run_id}.json"


def write(run_id: str, session_id: str, partial: dict) -> None:
    """Atomically checkpoint the in-flight partial (tmp + rename)."""
    payload = {
        "run_id": run_id,
        "session_id": session_id,
        "partial": partial,
        "updated_at": time.time(),
    }
    try:
        path = _path(run_id)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        logger.debug("[hms.run_snapshot] write failed for %s", run_id, exc_info=True)


def delete(run_id: str) -> None:
    try:
        _path(run_id).unlink(missing_ok=True)
    except OSError:
        logger.debug("[hms.run_snapshot] delete failed for %s", run_id, exc_info=True)


def _read_all() -> list[dict]:
    out: list[dict] = []
    try:
        for f in run_snapshots_dir().glob("*.json"):
            try:
                out.append(json.loads(f.read_text("utf-8")))
            except Exception:
                logger.debug("[hms.run_snapshot] skip unreadable %s", f, exc_info=True)
                continue
    except OSError:
        return []
    return out


def orphan_for_session(session_id: str) -> dict | None:
    """The most recent surviving (= crashed) snapshot for ``session_id``."""
    best: dict | None = None
    for data in _read_all():
        if data.get("session_id") != session_id:
            continue
        if best is None or data.get("updated_at", 0) > best.get("updated_at", 0):
            best = data
    return best


def delete_for_session(session_id: str) -> None:
    """Drop a session's snapshots — a new run supersedes the crashed partial."""
    try:
        for f in run_snapshots_dir().glob("*.json"):
            try:
                data = json.loads(f.read_text("utf-8"))
            except Exception:
                logger.debug("[hms.run_snapshot] skip unreadable %s", f, exc_info=True)
                continue
            if data.get("session_id") == session_id:
                f.unlink(missing_ok=True)
    except OSError:
        logger.debug("[hms.run_snapshot] delete_for_session failed", exc_info=True)


def sweep(max_age_s: float) -> int:
    """Delete snapshots older than ``max_age_s`` (startup hygiene). Returns the
    number removed — bounds disk use if a recovery is never viewed."""
    removed = 0
    cutoff = time.time() - max_age_s
    try:
        for f in run_snapshots_dir().glob("*.json"):
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink(missing_ok=True)
                    removed += 1
            except OSError:
                continue
    except OSError:
        return removed
    return removed


__all__ = ["write", "delete", "orphan_for_session", "delete_for_session", "sweep"]
