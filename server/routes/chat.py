"""Chat domain — sessions CRUD + per-session messages + FTS search.

Sessions and messages live in one module because they are one domain:
sessions are containers, messages are their content, and the SPA's
``useChatStore`` projects them together.
"""

from __future__ import annotations

import json
import logging
import re

from aiohttp import web

from server.lib.route_helpers import SESSION_ID_RE, coerce_int_arg
from server.lib.state_db import db, run_db

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

_KNOWN_SOURCE_PREFIX_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,32}$")
_SOURCE_TOKEN_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,32}$")
_VALID_SEARCH_SORTS = frozenset({"newest", "oldest"})


def _valid_session_id(sid: str) -> bool:
    return bool(sid and SESSION_ID_RE.match(sid))


def _split_csv(raw: str | None, *, validator: re.Pattern[str]) -> list[str] | None:
    if not raw:
        return None
    items = [s.strip() for s in raw.split(",") if s.strip()]
    if not items:
        return None
    if not all(validator.match(s) for s in items):
        return None
    return items


# ── Sessions CRUD ────────────────────────────────────────────────────


@router.get("/api/sessions")
async def list_sessions(request: web.Request) -> web.Response:
    """SPA panels key off session_id; normalise id→session_id so clicks don't silently no-op."""
    # hi=5000 — previously 500 silently clamped the SessionsPanel limit=1000 request.
    limit = coerce_int_arg(request.query.get("limit"), 50, lo=1, hi=5000)
    offset = coerce_int_arg(request.query.get("offset"), 0, lo=0, hi=1_000_000)
    source = request.query.get("source") or None
    if source is not None and not _KNOWN_SOURCE_PREFIX_RE.match(source):
        return web.json_response({"error": "invalid_source"}, status=400)

    order_by_last_active = (request.query.get("sort") or "started_at") == "last_active"

    try:
        rows = await run_db(
            db().list_sessions_rich,
            source=source,
            limit=limit,
            offset=offset,
            order_by_last_active=order_by_last_active,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("list_sessions failed")
        return web.json_response({"error": "db_error", "detail": str(exc)}, status=500)

    normalised: list[dict] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        rid = row.get("session_id") or row.get("id")
        if not rid:
            continue
        if "session_id" not in row:
            row = {**row, "session_id": rid}
        normalised.append(row)

    return web.json_response({"sessions": normalised})


@router.get("/api/sessions/{session_id}")
async def get_session(request: web.Request) -> web.Response:
    sid = request.match_info["session_id"]
    if not _valid_session_id(sid):
        return web.json_response({"error": "invalid_session_id"}, status=400)
    row = await run_db(db().get_session, sid)
    if row is None:
        return web.json_response({"error": "not_found"}, status=404)
    if isinstance(row, dict) and "session_id" not in row and row.get("id"):
        row = {**row, "session_id": row["id"]}
    return web.json_response(row)


@router.patch("/api/sessions/{session_id}")
async def patch_session(request: web.Request) -> web.Response:
    sid = request.match_info["session_id"]
    if not _valid_session_id(sid):
        return web.json_response({"error": "invalid_session_id"}, status=400)

    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)

    if "title" in body:
        title = body["title"]
        if not isinstance(title, str):
            return web.json_response({"error": "invalid_title"}, status=400)
        try:
            ok = await run_db(db().set_session_title, sid, title)
        except ValueError as exc:
            return web.json_response(
                {"error": "title_conflict", "detail": str(exc)}, status=409
            )
        if not ok:
            return web.json_response({"error": "not_found"}, status=404)
        return web.json_response({"ok": True})

    return web.json_response({"error": "no_supported_fields"}, status=400)


@router.delete("/api/sessions/{session_id}")
async def delete_session_route(request: web.Request) -> web.Response:
    sid = request.match_info["session_id"]
    if not _valid_session_id(sid):
        return web.json_response({"error": "invalid_session_id"}, status=400)
    deleted = await run_db(db().delete_session, sid)
    if not deleted:
        return web.json_response({"error": "not_found"}, status=404)
    return web.json_response({"ok": True})


# ── Messages + Search ────────────────────────────────────────────────


@router.get("/api/sessions/{session_id}/messages")
async def get_session_messages(request: web.Request) -> web.Response:
    sid = request.match_info["session_id"]
    if not SESSION_ID_RE.match(sid):
        return web.json_response({"error": "invalid_session_id"}, status=400)
    # Tail-slice from upstream's full transcript: offset counts back from the tail.
    limit = coerce_int_arg(request.query.get("limit"), 200, lo=1, hi=5000)
    offset = coerce_int_arg(request.query.get("offset"), 0, lo=0, hi=1_000_000)
    try:
        messages = await run_db(db().get_messages, sid)
    except Exception as exc:  # noqa: BLE001
        logger.exception("get_messages failed")
        return web.json_response({"error": "db_error", "detail": str(exc)}, status=500)
    total = len(messages)
    end = total - offset if offset > 0 else total
    start = max(0, end - limit)
    sliced = messages[start:end]
    return web.json_response({"messages": sliced, "total": total, "offset": offset})


@router.get("/api/sessions/{session_id}/interrupted")
async def get_session_interrupted(request: web.Request) -> web.Response:
    """Crash recovery: the partial answer of a run that died mid-turn for this
    session (the gateway crashed before persisting it), so the SPA can render it
    as an *interrupted* message on load. ``{partial: null}`` when nothing to
    recover. A run still active in this process is resuming over the WS, not
    crashed — return null for those."""
    sid = request.match_info["session_id"]
    if not SESSION_ID_RE.match(sid):
        return web.json_response({"error": "invalid_session_id"}, status=400)
    from server import runs
    from server.lib import run_snapshot
    snap = await run_db(run_snapshot.orphan_for_session, sid)
    if snap is None:
        return web.json_response({"partial": None})
    handle = await runs.get_registry().get(snap.get("run_id", ""))
    if handle is not None:
        return web.json_response({"partial": None})
    return web.json_response({
        "run_id": snap.get("run_id"),
        "updated_at": snap.get("updated_at"),
        "partial": snap.get("partial"),
    })


@router.get("/api/search")
async def search_messages_route(request: web.Request) -> web.Response:
    q = (request.query.get("q") or "").strip()
    if not q:
        return web.json_response({"results": []})
    limit = coerce_int_arg(request.query.get("limit"), 20, lo=1, hi=100)
    offset = coerce_int_arg(request.query.get("offset"), 0, lo=0, hi=10_000)

    source_csv = request.query.get("source") or request.query.get("sources")
    source_filter = _split_csv(source_csv, validator=_SOURCE_TOKEN_RE)
    if source_filter is None and source_csv:
        return web.json_response({"error": "invalid_source"}, status=400)

    exclude_csv = request.query.get("exclude_source") or request.query.get("exclude_sources")
    exclude_sources = _split_csv(exclude_csv, validator=_SOURCE_TOKEN_RE)
    if exclude_sources is None and exclude_csv:
        return web.json_response({"error": "invalid_exclude_source"}, status=400)

    role_filter = _split_csv(request.query.get("role"), validator=_SOURCE_TOKEN_RE)

    sort = request.query.get("sort")
    if sort and sort not in _VALID_SEARCH_SORTS:
        return web.json_response({"error": "invalid_sort"}, status=400)

    try:
        hits = await run_db(
            db().search_messages,
            q,
            source_filter=source_filter,
            exclude_sources=exclude_sources,
            role_filter=role_filter,
            limit=limit,
            offset=offset,
            sort=sort,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("search_messages failed")
        return web.json_response({"error": "db_error", "detail": str(exc)}, status=500)
    return web.json_response({"results": hits})


def attach(app: web.Application) -> None:
    app.router.add_routes(router)


__all__ = ["attach"]
