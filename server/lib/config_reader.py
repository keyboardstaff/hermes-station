"""Dynamic readers for upstream-owned config values from ~/.hermes/config.yaml.

NEVER inline ports/hosts/tokens as literals — defer to whatever the host produces at runtime.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any, TypedDict

from server.lib.upstream_paths import hermes_home

_PLATFORM_NAME = "station"


class _Fallback(TypedDict):
    host: str
    port: int
    session_ttl_seconds: int
    cors_origins: tuple[str, ...]
    max_concurrent_runs: int
    max_upload_bytes: int
    upload_retention_days: int
    rate_limit_per_minute: int
    rate_limit_loopback_per_minute: int


# Used only when neither config.yaml nor env vars specify a value (fresh install).
# Typed so per-key access narrows (str/int/tuple) — callers feed these to
# typed helpers (_coerce_int, list(...)) without a union-type complaint.
_FALLBACK: _Fallback = {
    "host": "127.0.0.1",
    "port": 1313,
    "session_ttl_seconds": 86400,
    "cors_origins": (),
    "max_concurrent_runs": 10,
    "max_upload_bytes": 50 * 1024 * 1024,
    "upload_retention_days": 30,
    # The SPA fans out dozens of requests per page load; a couple of quick
    # refreshes legitimately exceeded the old flat 100/min. Loopback is the
    # trusted single-user norm (the auth model already trusts it), so it gets
    # generous headroom; a remote peer (only reachable with a token) stays
    # strict as a DoS safety net. Both overridable in config.yaml extra.
    "rate_limit_per_minute": 240,
    "rate_limit_loopback_per_minute": 3000,
}


def _load_yaml() -> dict:
    import yaml  # type: ignore[import-not-found]
    path = hermes_home() / "config.yaml"
    try:
        with path.open("r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        return {}


def reload() -> None:
    _cached_extra.cache_clear()
    _cached_doc.cache_clear()


@lru_cache(maxsize=1)
def _cached_doc() -> dict:
    return _load_yaml()


@lru_cache(maxsize=1)
def _cached_extra() -> dict:
    doc = _cached_doc()
    platforms = doc.get("platforms") or {}
    section = platforms.get(_PLATFORM_NAME) or {}
    extra = section.get("extra") or {}
    return extra if isinstance(extra, dict) else {}


def _coerce_int(v: Any, fallback: int) -> int:
    try:
        return int(v) if v is not None and v != "" else fallback
    except (TypeError, ValueError):
        return fallback


def hms_host() -> str:
    env = os.getenv("HMS_HOST")
    if env:
        return env
    val = _cached_extra().get("host")
    if isinstance(val, str) and val:
        return val
    return _FALLBACK["host"]


def hms_port() -> int:
    return _coerce_int(
        os.getenv("HMS_PORT") or _cached_extra().get("port"),
        _FALLBACK["port"],
    )


def hms_password_hash() -> str:
    """Returns empty string when no password is set."""
    env = os.getenv("HMS_PASSWORD_HASH")
    if env:
        return env.strip()
    val = _cached_extra().get("password_hash")
    return val.strip() if isinstance(val, str) else ""


def hms_user_name() -> str:
    """The configured login/display name (empty when unset)."""
    val = _cached_extra().get("user_name")
    return val.strip() if isinstance(val, str) else ""


def hms_onboarded() -> bool:
    """Whether the first-run setup wizard has been completed or skipped."""
    return bool(_cached_extra().get("onboarded"))


def hms_session_ttl_seconds() -> int:
    return _coerce_int(
        os.getenv("HMS_SESSION_TTL")
        or _cached_extra().get("session_ttl_seconds"),
        _FALLBACK["session_ttl_seconds"],
    )


def max_concurrent_runs() -> int:
    return _coerce_int(
        os.getenv("HMS_MAX_CONCURRENT_RUNS")
        or _cached_extra().get("max_concurrent_runs"),
        _FALLBACK["max_concurrent_runs"],
    )


def max_upload_bytes() -> int:
    return _coerce_int(
        os.getenv("HMS_MAX_UPLOAD_BYTES")
        or _cached_extra().get("max_upload_bytes"),
        _FALLBACK["max_upload_bytes"],
    )


def upload_retention_days() -> int:
    return _coerce_int(
        os.getenv("HMS_UPLOAD_RETENTION_DAYS")
        or _cached_extra().get("upload_retention_days"),
        _FALLBACK["upload_retention_days"],
    )


def rate_limit_per_minute() -> int:
    """Per-IP request cap for non-loopback peers (DoS safety net)."""
    return _coerce_int(
        os.getenv("HMS_RATE_LIMIT_PER_MINUTE")
        or _cached_extra().get("rate_limit_per_minute"),
        _FALLBACK["rate_limit_per_minute"],
    )


def rate_limit_loopback_per_minute() -> int:
    """Per-IP request cap for trusted loopback peers — generous so the SPA's
    fan-out + a few refreshes never trip it, but still bounds a runaway client."""
    return _coerce_int(
        os.getenv("HMS_RATE_LIMIT_LOOPBACK_PER_MINUTE")
        or _cached_extra().get("rate_limit_loopback_per_minute"),
        _FALLBACK["rate_limit_loopback_per_minute"],
    )


def hms_cors_origins() -> tuple[str, ...]:
    raw = os.getenv("HMS_CORS_ORIGINS") or _cached_extra().get("cors_origins")
    if isinstance(raw, str):
        items = [s.strip() for s in raw.split(",") if s.strip()]
    elif isinstance(raw, (list, tuple)):
        items = [str(s).strip() for s in raw if str(s).strip()]
    else:
        items = list(_FALLBACK["cors_origins"])
    return tuple(items)


def dashboard_url() -> str:
    env = os.getenv("HERMES_DASHBOARD_URL")
    if env:
        return env
    dash = _cached_doc().get("dashboard") or {}
    host = dash.get("host") or "127.0.0.1"
    port = dash.get("port") or 9119
    return f"http://{host}:{port}"


def dashboard_token() -> str:
    env = os.getenv("HERMES_DASHBOARD_TOKEN", "")
    if env:
        return env
    return (_cached_doc().get("dashboard") or {}).get("token", "") or ""


def dashboard_autostart() -> bool:
    """Station supervises the dashboard sidecar; default true."""
    env = os.getenv("HMS_DASHBOARD_AUTOSTART")
    if env is not None:
        return env.strip().lower() not in ("0", "false", "no", "")
    dash = _cached_extra().get("dashboard") or {}
    val = dash.get("autostart") if isinstance(dash, dict) else None
    if val is None:
        return True
    return bool(val)


def gateway_autostart() -> bool:
    """One-shot launchd start at boot if gateway is installed but stopped; default true."""
    env = os.getenv("HMS_GATEWAY_AUTOSTART")
    if env is not None:
        return env.strip().lower() not in ("0", "false", "no", "")
    gw = _cached_extra().get("gateway") or {}
    val = gw.get("autostart") if isinstance(gw, dict) else None
    if val is None:
        return True
    return bool(val)


def spa_dist_dir() -> Path | None:
    """Locate dist/ via HMS_DIST_DIR or <repo>/dist; None when absent (dev mode)."""
    env = os.getenv("HMS_DIST_DIR")
    candidates: list[Path] = []
    if env:
        candidates.append(Path(env).expanduser())
    candidates.append(Path(__file__).resolve().parent.parent.parent / "dist")
    for cand in candidates:
        if cand.is_dir() and (cand / "index.html").is_file():
            return cand
    return None
