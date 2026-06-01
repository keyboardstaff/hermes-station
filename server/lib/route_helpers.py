"""Tiny shared validators / coercers used across route modules."""

from __future__ import annotations

import re

SESSION_ID_RE = re.compile(r"^[\w\-:.]{1,128}$")


def coerce_int_arg(value: str | None, default: int, *, lo: int, hi: int) -> int:
    if value is None or value == "":
        return default
    try:
        v = int(value)
    except ValueError:
        return default
    return max(lo, min(hi, v))


__all__ = ["SESSION_ID_RE", "coerce_int_arg"]
