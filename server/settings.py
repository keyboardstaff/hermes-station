"""High-level settings API — read/write ~/.hermes/config.yaml platforms.station.extra.*"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

from server.lib import config_reader, yaml_edit
from server.lib.upstream_paths import hermes_home

_PLATFORM_PATH = ("platforms", "station")
_EXTRA_PATH = (*_PLATFORM_PATH, "extra")
_ALLOWED_KEYS = frozenset({
    "host",
    "port",
    "password_hash",
    "session_ttl_seconds",
    "cors_origins",
    "max_concurrent_runs",
    "max_upload_bytes",
    "upload_retention_days",
})

_MIB = 1024 * 1024


def config_yaml_path() -> Path:
    return hermes_home() / "config.yaml"


def read_extra() -> dict[str, Any]:
    return dict(config_reader._cached_extra())  # noqa: SLF001


class SettingsError(ValueError):
    pass


def _validate(updates: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in updates.items():
        if key not in _ALLOWED_KEYS:
            raise SettingsError(f"unknown_key:{key}")
        if key == "host":
            if value not in ("127.0.0.1", "0.0.0.0"):  # noqa: S104
                raise SettingsError("invalid_value:host")
            out[key] = value
        elif key == "port":
            try:
                ival = int(value)
            except (TypeError, ValueError) as exc:
                raise SettingsError("invalid_value:port") from exc
            if not 1 <= ival <= 65535:
                raise SettingsError("invalid_value:port")
            out[key] = ival
        elif key == "password_hash":
            if not isinstance(value, str):
                raise SettingsError("invalid_value:password_hash")
            out[key] = value
        elif key == "session_ttl_seconds":
            try:
                ival = int(value)
            except (TypeError, ValueError) as exc:
                raise SettingsError("invalid_value:session_ttl_seconds") from exc
            if ival < 60:
                raise SettingsError("invalid_value:session_ttl_seconds")
            out[key] = ival
        elif key == "cors_origins":
            if isinstance(value, str):
                items = [s.strip() for s in value.split(",") if s.strip()]
            elif isinstance(value, (list, tuple)):
                items = [str(s).strip() for s in value if str(s).strip()]
            else:
                raise SettingsError("invalid_value:cors_origins")
            out[key] = items
        elif key == "max_concurrent_runs":
            try:
                ival = int(value)
            except (TypeError, ValueError) as exc:
                raise SettingsError("invalid_value:max_concurrent_runs") from exc
            if not 1 <= ival <= 100:
                raise SettingsError("invalid_value:max_concurrent_runs")
            out[key] = ival
        elif key == "max_upload_bytes":
            try:
                ival = int(value)
            except (TypeError, ValueError) as exc:
                raise SettingsError("invalid_value:max_upload_bytes") from exc
            if not _MIB <= ival <= 500 * _MIB:
                raise SettingsError("invalid_value:max_upload_bytes")
            out[key] = ival
        elif key == "upload_retention_days":
            try:
                ival = int(value)
            except (TypeError, ValueError) as exc:
                raise SettingsError("invalid_value:upload_retention_days") from exc
            if not 1 <= ival <= 365:
                raise SettingsError("invalid_value:upload_retention_days")
            out[key] = ival
    return out


def apply_extra_update(updates: Mapping[str, Any]) -> dict[str, Any]:
    """Validate + persist; reject host=0.0.0.0 without a password_hash (LAN safety)."""
    cleaned = _validate(updates)

    current = read_extra()
    after = {**current, **cleaned}
    if after.get("host") == "0.0.0.0" and not (after.get("password_hash") or "").strip():  # noqa: S104
        raise SettingsError("host_requires_password")

    cfg_path = config_yaml_path()
    src = cfg_path.read_text(encoding="utf-8") if cfg_path.exists() else ""
    for key, value in cleaned.items():
        if isinstance(value, list):
            src = yaml_edit.set_scalar_at_path(src, (*_EXTRA_PATH, key), value)
        else:
            src = yaml_edit.set_scalar_at_path(src, (*_EXTRA_PATH, key), value)
    yaml_edit.write_text_atomic(cfg_path, src, mode=0o600)
    config_reader.reload()
    return cleaned


def append_allowlist_entry(pattern_key: str) -> bool:
    """Idempotent append to root command_allowlist (consumed by tools.approval)."""
    cfg_path = config_yaml_path()
    src = cfg_path.read_text(encoding="utf-8") if cfg_path.exists() else ""
    before = src
    src = yaml_edit.append_list_item_at_path(src, ("command_allowlist",), pattern_key)
    if src == before:
        return False
    yaml_edit.write_text_atomic(cfg_path, src, mode=0o600)
    config_reader.reload()
    return True
