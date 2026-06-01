"""Hermes Station gateway platform plugin entry point."""

from __future__ import annotations

from typing import Any

__all__ = ["register"]


def _check_requirements() -> bool:
    try:
        import aiohttp  # noqa: F401
        return True
    except ImportError:
        return False


def _requires_password(cfg: Any) -> bool:
    extra = getattr(cfg, "extra", None) or {}
    host = str(extra.get("host") or "127.0.0.1").strip()
    if host in ("127.0.0.1", "localhost", "::1", ""):
        return False
    return not str(extra.get("password_hash") or "").strip()


def _validate_config(cfg: Any) -> bool:
    if not getattr(cfg, "enabled", False):
        return False
    return not _requires_password(cfg)


def _is_connected(cfg: Any) -> bool:
    if not getattr(cfg, "enabled", False):
        return False
    return not _requires_password(cfg)


def register(ctx: Any) -> None:
    from server.adapter import StationAdapter

    ctx.register_platform(
        name="station",
        label="Station",
        adapter_factory=lambda cfg: StationAdapter(cfg),
        check_fn=_check_requirements,
        validate_config=_validate_config,
        is_connected=_is_connected,
        required_env=[],
        install_hint="pip install aiohttp argon2-cffi PyYAML",
        emoji="🛰️",
        pii_safe=True,
    )
