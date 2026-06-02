"""Process-wide SessionDB singleton — all routes share one connection pool.

``db()`` is the default-home SessionDB every route uses. ``db_for_home(home)``
is the profile-scoped variant: a per-home cache used by the run path when the
Composer pill re-scopes a turn to another profile. The
HERMES_HOME override (``profile_run``) covers config/.env/skills, but a
``SessionDB`` captures its ``db_path`` at construction, so the run must read /
write the chosen profile's ``state.db`` explicitly through this cache.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

logger = logging.getLogger(__name__)

_T = TypeVar("_T")

_lock = threading.Lock()
_singleton: Any = None
# Profile-scoped SessionDBs keyed by resolved home path. Separate from the
# default singleton so per-profile runs never disturb the shared connection.
_by_home: dict[str, Any] = {}


def _SessionDB() -> Any:
    # Local import breaks the shim → state_db → shim cycle.
    from server.lib.upstream_shim import shim
    SessionDB = shim.state.SessionDB
    if SessionDB is None:
        raise RuntimeError(
            "upstream hermes_state.SessionDB unavailable — "
            "is hermes-agent installed?"
        )
    return SessionDB


def db() -> Any:
    global _singleton
    if _singleton is None:
        with _lock:
            if _singleton is None:
                _singleton = _SessionDB()()
    return _singleton


def db_for_home(home: Path | str | None) -> Any:
    """SessionDB bound to ``home``/state.db; falls back to ``db()`` for None.

    Cached per resolved home path so a profile's connection is reused across
    its runs. ``None`` (default profile / no override) returns the shared
    default-home singleton.
    """
    if home is None:
        return db()
    key = str(Path(home).resolve())
    cached = _by_home.get(key)
    if cached is not None:
        return cached
    with _lock:
        cached = _by_home.get(key)
        if cached is None:
            from server.lib.upstream_paths import state_db_path
            cached = _SessionDB()(db_path=state_db_path(Path(key)))
            _by_home[key] = cached
    return cached


async def run_db(fn: Callable[..., _T], *args: Any, **kwargs: Any) -> _T:
    """Marshal a sync SessionDB method off the event loop."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


def close_for_test() -> None:
    global _singleton
    with _lock:
        for inst in (_singleton, *_by_home.values()):
            if inst is not None:
                try:
                    inst.close()
                except Exception:
                    logger.debug("[hms.state_db] close_for_test failed", exc_info=True)
        _singleton = None
        _by_home.clear()
