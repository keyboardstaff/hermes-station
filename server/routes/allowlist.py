"""Allowlist management for root command_allowlist in config.yaml.

All mutations go through upstream save_permanent_allowlist so a running gateway
picks them up on next load; the in-process _permanent_approved set is also synced.
"""

from __future__ import annotations

import json
import logging
import re

from aiohttp import web

from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

# Upstream pattern keys index into HARDLINE_PATTERNS / DANGEROUS_PATTERNS (snake_case).
_PATTERN_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def _load_current() -> set[str]:
    load_permanent_allowlist = shim.approval.load_allowlist
    if load_permanent_allowlist is None:
        raise RuntimeError("upstream tools.approval.load_permanent_allowlist unavailable")
    return load_permanent_allowlist()


def _save(patterns: set[str]) -> None:
    save_permanent_allowlist = shim.approval.save_allowlist
    if save_permanent_allowlist is None:
        raise RuntimeError("upstream tools.approval.save_permanent_allowlist unavailable")
    save_permanent_allowlist(patterns)


def _refresh_runtime(patterns: set[str]) -> None:
    load_permanent = shim.approval.load_permanent
    if load_permanent is None:
        # Older upstream lacks this — next run picks up disk state anyway.
        return
    load_permanent(patterns)


@router.get("/api/allowlist")
async def list_allowlist(request: web.Request) -> web.Response:
    try:
        current = _load_current()
    except Exception:
        logger.exception("[hms.allowlist] load failed")
        return web.json_response({"error": "internal_error"}, status=500)
    return web.json_response({"patterns": sorted(current)})


@router.post("/api/allowlist")
async def add_allowlist(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)
    pk = body.get("pattern_key")
    if not isinstance(pk, str) or not _PATTERN_RE.match(pk):
        return web.json_response({"error": "invalid_pattern_key"}, status=400)

    try:
        current = _load_current()
        if pk in current:
            return web.json_response(
                {"ok": True, "added": False, "patterns": sorted(current)},
                status=200,
            )
        current.add(pk)
        _save(current)
        _refresh_runtime(current)
    except Exception:
        logger.exception("[hms.allowlist] add failed")
        return web.json_response({"error": "internal_error"}, status=500)
    return web.json_response(
        {"ok": True, "added": True, "patterns": sorted(current)},
        status=201,
    )


@router.delete("/api/allowlist/{pattern_key}")
async def delete_allowlist(request: web.Request) -> web.Response:
    pk = request.match_info.get("pattern_key", "")
    if not _PATTERN_RE.match(pk):
        return web.json_response({"error": "invalid_pattern_key"}, status=400)

    try:
        current = _load_current()
        if pk not in current:
            return web.json_response(
                {"ok": True, "removed": False, "patterns": sorted(current)},
                status=200,
            )
        current.discard(pk)
        _save(current)
        _refresh_runtime(current)
    except Exception:
        logger.exception("[hms.allowlist] delete failed")
        return web.json_response({"error": "internal_error"}, status=500)
    return web.json_response(
        {"ok": True, "removed": True, "patterns": sorted(current)},
        status=200,
    )


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
