"""Station-owned user preferences that should follow the owner across browsers
and devices — unlike the genuinely device/viewport UI prefs kept in the SPA's
localStorage (theme, panel widths, sidebar module, …).

A small JSON sidecar under the Station data dir. Owner-level, NOT per-profile:
the sessions list aggregates across profiles, so a pin references a globally
addressable session id and should be visible regardless of the active profile.
Structured as a key→value document so new synced prefs can be added without a
schema change; ``pinned_sessions`` is the first key.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from server.lib.upstream_paths import hms_data_dir

logger = logging.getLogger(__name__)

_FILENAME = "preferences.json"
_PINNED_KEY = "pinned_sessions"
# Bound the on-disk set so a misbehaving client can't grow the file unboundedly.
_PINNED_MAX = 1000


def _path() -> Path:
    return hms_data_dir() / _FILENAME


def _read() -> dict:
    try:
        data = json.loads(_path().read_text("utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        logger.debug("[hms.station_prefs] unreadable prefs file", exc_info=True)
        return {}
    return data if isinstance(data, dict) else {}


def _write(data: dict) -> None:
    """Atomic write (tmp + rename) so a crash can't leave a half-written file."""
    path = _path()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    tmp.replace(path)


def _clean(ids: object) -> list[str]:
    """Coerce to str, drop empties, de-dup (order-preserving), cap the length."""
    if not isinstance(ids, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for x in ids:
        s = str(x)
        if s and s not in seen:
            seen.add(s)
            out.append(s)
        if len(out) >= _PINNED_MAX:
            break
    return out


def get_pinned() -> list[str]:
    return _clean(_read().get(_PINNED_KEY))


def set_pinned(ids: list[str]) -> list[str]:
    """Persist the pinned set (cleaned) and return what was stored. Raises
    ``OSError`` on write failure so the route can surface a 500."""
    cleaned = _clean(ids)
    data = _read()
    data[_PINNED_KEY] = cleaned
    _write(data)
    return cleaned


__all__ = ["get_pinned", "set_pinned"]
