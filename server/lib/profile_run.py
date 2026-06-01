"""Run a chat turn under a specific Hermes profile, in-process, no restart.

Station loads inside one gateway process whose ``HERMES_HOME`` is fixed at
launch. To let the Composer's profile pill actually re-scope a run (owner
review D17) without spawning a sibling gateway or restarting, we lean on the
same mechanism upstream's cron scheduler uses for per-job profiles
(``cron/scheduler._job_profile_context``): the context-local
``set_hermes_home_override`` ``ContextVar`` plus an ``os.environ`` snapshot.

While the override is active, ``get_hermes_home()`` — and therefore config /
.env loading, ``AIAgent`` construction, skills, and memory resolution — all
point at the selected profile's home. ``state.db`` is *not* covered by the
override (the SessionDB path is captured at construction), so the run path
pairs this with ``state_db.db_for_home`` to read/write the right profile's
sessions.

Concurrency: the override is a ``ContextVar`` (coroutine-local) but the
``os.environ`` snapshot is process-global, so — like cron — overlapping
profile runs are not safe to interleave. Callers must hold these around the
synchronous build+run on a worker thread and avoid concurrent differing
overrides; see ``server.runs`` which serializes the override window per run.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)


def resolve_profile_home(profile: str | None) -> Path | None:
    """Absolute home dir for ``profile``; ``None`` for default/unset/invalid.

    ``None`` means "run under the process's own HERMES_HOME" (no override) —
    the default profile resolves there anyway, so we skip the override cost.
    """
    name = (profile or "").strip()
    if not name or name == "default":
        return None
    get_profile_dir = shim.profiles.get_profile_dir
    if get_profile_dir is None:
        return None
    try:
        home = Path(get_profile_dir(name)).resolve()
    except Exception:
        logger.warning("[hms.profile_run] get_profile_dir(%r) failed", name, exc_info=True)
        return None
    return home if home.is_dir() else None


@contextmanager
def profile_home_override(profile: str | None) -> Iterator[Path | None]:
    """Temporarily point ``get_hermes_home()`` at ``profile``'s home.

    No-op (yields ``None``) for the default/unset profile or when upstream's
    override API is unavailable. Mirrors ``cron/scheduler._job_profile_context``:
    sets the context-local override and restores the ``os.environ`` delta on
    exit so profile ``.env`` mutations don't leak.
    """
    home = resolve_profile_home(profile)
    if home is None:
        yield None
        return

    set_override = shim.profiles.set_hermes_home_override
    reset_override = shim.profiles.reset_hermes_home_override
    if set_override is None or reset_override is None:
        # Upstream too old to support in-process override — fail open to the
        # process default rather than crash the run.
        logger.warning(
            "[hms.profile_run] set/reset_hermes_home_override unavailable — "
            "run stays on the process HERMES_HOME"
        )
        yield None
        return

    env_snapshot = os.environ.copy()
    token = None
    try:
        token = set_override(str(home))
        yield home
    finally:
        if token is not None:
            try:
                reset_override(token)
            except Exception:
                logger.debug("[hms.profile_run] reset override failed", exc_info=True)
        # Delta restore (added keys removed, changed keys restored) — avoids a
        # window where another thread sees a half-cleared env.
        added = set(os.environ.keys()) - set(env_snapshot.keys())
        for k in added:
            os.environ.pop(k, None)
        for k, v in env_snapshot.items():
            if os.environ.get(k) != v:
                os.environ[k] = v


__all__ = ["resolve_profile_home", "profile_home_override"]
