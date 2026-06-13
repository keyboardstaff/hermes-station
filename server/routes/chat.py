"""Chat domain — sessions CRUD + per-session messages + FTS search.

Sessions and messages live in one module because they are one domain:
sessions are containers, messages are their content, and the SPA's
``useChatStore`` projects them together.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any

from aiohttp import web

from server.lib.route_helpers import SESSION_ID_RE, PROFILE_ID_RE, coerce_int_arg
from server.lib.state_db import db, db_for_home, run_db

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

# Single pattern covers both source-filter tokens and CSV-split validation.
_SOURCE_TOKEN_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,32}$")
_VALID_SEARCH_SORTS = frozenset({"newest", "oldest"})


def _valid_session_id(sid: str) -> bool:
    return bool(sid and SESSION_ID_RE.match(sid))


def _session_db(request: web.Request) -> tuple[Any, web.Response | None]:
    """SessionDB for the request's ``?profile=`` (default / unset → process ``db()``).

    A non-default profile's sessions live in its OWN ``state.db``, so a per-session
    read or mutation must open *that* db — otherwise a non-default-profile session
    404s on read, or a mutation lands in the wrong home. Mirrors upstream desktop's
    read routing (``getSessionMessages(id, profile)`` → "the primary opens that
    profile's state.db via ``?profile=``"): the cross-home aggregation tags each
    row with its ``profile``, and the SPA echoes that tag back here. An unknown /
    unresolvable named profile falls back to ``db()`` (the row may be the default
    profile's); a malformed profile name is rejected, not silently coerced.
    """
    from server.lib.profile_run import resolve_profile_home

    raw = request.query.get("profile")
    if not raw or raw == "default":
        return db(), None
    if not PROFILE_ID_RE.match(raw):
        return None, web.json_response({"error": "invalid_profile"}, status=400)
    home = resolve_profile_home(raw)
    return (db() if home is None else db_for_home(home)), None


def _split_csv(raw: str | None, *, validator: re.Pattern[str]) -> list[str] | None:
    if not raw:
        return None
    items = [s.strip() for s in raw.split(",") if s.strip()]
    if not items:
        return None
    if not all(validator.match(s) for s in items):
        return None
    return items


def _profile_homes() -> list[tuple[str, Path | None]]:
    """``(profile_name, home)`` for every profile — default first, then named.

    ``home`` is ``None`` for the default profile (the process ``db()``) or a
    resolved ``Path`` for a named one. Sessions live in each profile's own
    ``state.db``, so the listing reads them all and tags each row — otherwise a
    non-default profile's chats are invisible in Recents / the sessions table.
    """
    from server.lib.profile_run import resolve_profile_home
    from server.lib.upstream_shim import shim

    homes: list[tuple[str, Path | None]] = [("default", None)]
    lister = shim.profiles.list_profiles
    if lister is None:
        return homes
    try:
        items = lister() or []
    except Exception:
        logger.warning("[hms.chat] list_profiles failed; default-only listing", exc_info=True)
        return homes
    for p in items:
        name = p.get("name") if isinstance(p, dict) else getattr(p, "name", None)
        if not name or name == "default":
            continue
        home = resolve_profile_home(str(name))
        if home is not None:
            homes.append((str(name), home))
    return homes


# ── Sessions CRUD ────────────────────────────────────────────────────


@router.get("/api/sessions")
async def list_sessions(request: web.Request) -> web.Response:
    """SPA panels key off session_id; normalise id→session_id so clicks don't silently no-op."""
    # hi=5000 — previously 500 silently clamped the SessionsPanel limit=1000 request.
    limit = coerce_int_arg(request.query.get("limit"), 50, lo=1, hi=5000)
    offset = coerce_int_arg(request.query.get("offset"), 0, lo=0, hi=1_000_000)
    source = request.query.get("source") or None
    if source is not None and not _SOURCE_TOKEN_RE.match(source):
        return web.json_response({"error": "invalid_source"}, status=400)

    order_by_last_active = (request.query.get("sort") or "started_at") == "last_active"
    # archived filter: "" / "exclude" → active only (default); "only" → archived
    # only; "include" → both. Mirrors upstream list_sessions_rich flags.
    archived_arg = (request.query.get("archived") or "").strip().lower()
    archived_only = archived_arg == "only"
    include_archived = archived_arg in ("include", "all")

    # Read each profile's own state.db, tag rows with their profile, then merge +
    # sort + page. Reading offset+limit per profile keeps the merged page correct;
    # default-only users read just db() (one query, unchanged). A default-DB
    # failure is a real error (500); a named profile's failure is skipped.
    per_profile = min(offset + limit, 5000)
    merged: list[dict] = []
    for name, home in _profile_homes():
        try:
            sdb = db() if home is None else db_for_home(home)
            rows = await run_db(
                sdb.list_sessions_rich,
                source=source,
                limit=per_profile,
                offset=0,
                order_by_last_active=order_by_last_active,
                include_archived=include_archived,
                archived_only=archived_only,
            )
        except Exception as exc:  # noqa: BLE001
            if home is None:
                logger.exception("list_sessions failed")
                return web.json_response({"error": "db_error", "detail": str(exc)}, status=500)
            logger.warning("[hms.chat] list_sessions failed for profile %s", name, exc_info=True)
            continue
        for row in rows or []:
            if isinstance(row, dict):
                merged.append({**row, "profile": name})

    sort_key = "last_active" if order_by_last_active else "started_at"
    merged.sort(
        key=lambda r: (
            r.get(sort_key) or r.get("started_at") or 0,
            0 if r.get("profile") == "default" else 1,
        ),
        reverse=True,
    )

    normalised: list[dict] = []
    seen: set[str] = set()
    for row in merged:
        rid = row.get("session_id") or row.get("id")
        if not rid:
            continue
        if rid in seen:
            continue
        if "session_id" not in row:
            row = {**row, "session_id": rid}
        seen.add(rid)
        normalised.append(row)

    return web.json_response({"sessions": normalised[offset:offset + limit]})


@router.get("/api/sessions/{session_id}")
async def get_session(request: web.Request) -> web.Response:
    sid = request.match_info["session_id"]
    if not _valid_session_id(sid):
        return web.json_response({"error": "invalid_session_id"}, status=400)
    sdb, err = _session_db(request)
    if err is not None:
        return err
    row = await run_db(sdb.get_session, sid)
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
    sdb, err = _session_db(request)
    if err is not None:
        return err

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
            ok = await run_db(sdb.set_session_title, sid, title)
        except ValueError as exc:
            return web.json_response(
                {"error": "title_conflict", "detail": str(exc)}, status=409
            )
        if not ok:
            return web.json_response({"error": "not_found"}, status=404)
        return web.json_response({"ok": True})

    if "archived" in body:
        archived = body["archived"]
        if not isinstance(archived, bool):
            return web.json_response({"error": "invalid_archived"}, status=400)
        set_archived = getattr(sdb, "set_session_archived", None)
        if set_archived is None:
            return web.json_response({"error": "unsupported"}, status=503)
        # Upstream archives the whole compression lineage (and unarchive resurrects
        # the tip); we just relay the flag.
        ok = await run_db(set_archived, sid, archived)
        if not ok:
            return web.json_response({"error": "not_found"}, status=404)
        return web.json_response({"ok": True})

    return web.json_response({"error": "no_supported_fields"}, status=400)


@router.delete("/api/sessions/{session_id}")
async def delete_session_route(request: web.Request) -> web.Response:
    sid = request.match_info["session_id"]
    if not _valid_session_id(sid):
        return web.json_response({"error": "invalid_session_id"}, status=400)
    sdb, err = _session_db(request)
    if err is not None:
        return err
    deleted = await run_db(sdb.delete_session, sid)
    if not deleted:
        return web.json_response({"error": "not_found"}, status=404)
    return web.json_response({"ok": True})


# ── Messages + Search ────────────────────────────────────────────────


@router.get("/api/sessions/{session_id}/messages")
async def get_session_messages(request: web.Request) -> web.Response:
    sid = request.match_info["session_id"]
    if not SESSION_ID_RE.match(sid):
        return web.json_response({"error": "invalid_session_id"}, status=400)
    sdb, err = _session_db(request)
    if err is not None:
        return err
    # Tail-slice from upstream's full transcript: offset counts back from the tail.
    limit = coerce_int_arg(request.query.get("limit"), 200, lo=1, hi=5000)
    offset = coerce_int_arg(request.query.get("offset"), 0, lo=0, hi=1_000_000)
    try:
        messages = await run_db(sdb.get_messages, sid)
    except Exception as exc:  # noqa: BLE001
        logger.exception("get_messages failed")
        return web.json_response({"error": "db_error", "detail": str(exc)}, status=500)
    total = len(messages)
    end = total - offset if offset > 0 else total
    start = max(0, end - limit)
    sliced = messages[start:end]
    return web.json_response({"messages": sliced, "total": total, "offset": offset})


@router.post("/api/sessions/{session_id}/clear")
async def clear_session_messages(request: web.Request) -> web.Response:
    """Wipe a session's transcript (upstream ``SessionDB.clear_messages``) while
    keeping the session row — a real "start this chat over" that the local-only
    view-clear can't do. Mutation ⇒ CSRF-gated by middleware."""
    sid = request.match_info["session_id"]
    if not SESSION_ID_RE.match(sid):
        return web.json_response({"error": "invalid_session_id"}, status=400)
    handle, err = _session_db(request)
    if err is not None:
        return err
    clear = getattr(handle, "clear_messages", None) if handle is not None else None
    if clear is None:
        return web.json_response({"error": "unsupported"}, status=503)
    try:
        await run_db(clear, sid)
        # Reset the title too, so the next turn's auto-title regenerates instead
        # of keeping the now-stale title of the wiped conversation.
        set_title = getattr(handle, "set_session_title", None)
        if set_title is not None:
            await run_db(set_title, sid, "")
    except Exception as exc:  # noqa: BLE001
        logger.exception("clear_messages failed")
        return web.json_response({"error": "db_error", "detail": str(exc)}, status=500)
    return web.json_response({"ok": True})


def _maybe_json(value: Any) -> Any:
    """Decode a JSON-string column for re-append. ``get_messages`` leaves
    reasoning_details / codex_* as raw JSON strings, but ``append_message``
    json.dumps its inputs — passing the string through would double-encode."""
    if isinstance(value, str) and value:
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return None
    return value


@router.post("/api/sessions/{session_id}/branch")
async def branch_session(request: web.Request) -> web.Response:
    """Branch-from-here: clone the session's transcript prefix into a NEW
    session, in-process mirror of the gateway's ``session.branch`` (create the
    row with a ``_branched_from`` marker + ``parent_session_id``, copy the
    message rows, lineage title). ``upto_row_exclusive`` cuts before that DB
    row id; omitted = clone everything. The branch opens with its copied
    history visible — unlike the old client-side seeding, which produced a
    visually blank session. Mutation ⇒ CSRF-gated by middleware."""
    sid = request.match_info["session_id"]
    if not SESSION_ID_RE.match(sid):
        return web.json_response({"error": "invalid_session_id"}, status=400)
    sdb, err = _session_db(request)
    if err is not None:
        return err

    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 — empty body is fine
        body = {}
    upto = body.get("upto_row_exclusive")
    if upto is not None and (not isinstance(upto, int) or isinstance(upto, bool) or upto <= 0):
        return web.json_response({"error": "invalid_upto_row"}, status=400)

    def _do() -> tuple[str, str, int]:
        rows = sdb.get_messages(sid)
        if upto is not None:
            rows = [r for r in rows if isinstance(r.get("id"), int) and r["id"] < upto]
        if not rows:
            raise ValueError("nothing to branch")
        new_id = f"run_{uuid.uuid4().hex}"
        base_title = sdb.get_session_title(sid) or "branch"
        get_next = getattr(sdb, "get_next_title_in_lineage", None)
        title = str(get_next(base_title)) if callable(get_next) else f"{base_title} (branch)"
        sdb.create_session(
            new_id,
            source="station",
            # Same stable marker the gateway's session.branch writes, so
            # upstream lineage views recognize the branch.
            model_config={"_branched_from": sid},
            parent_session_id=sid,
        )
        for m in rows:
            sdb.append_message(
                session_id=new_id,
                role=m.get("role", "user"),
                content=m.get("content"),
                tool_name=m.get("tool_name"),
                tool_calls=m.get("tool_calls"),
                tool_call_id=m.get("tool_call_id"),
                finish_reason=m.get("finish_reason"),
                reasoning=m.get("reasoning"),
                reasoning_content=m.get("reasoning_content"),
                reasoning_details=_maybe_json(m.get("reasoning_details")),
                codex_reasoning_items=_maybe_json(m.get("codex_reasoning_items")),
                codex_message_items=_maybe_json(m.get("codex_message_items")),
                platform_message_id=m.get("platform_message_id"),
                observed=bool(m.get("observed")),
            )
        sdb.set_session_title(new_id, title)
        return new_id, title, len(rows)

    try:
        new_id, title, copied = await run_db(_do)
    except ValueError:
        return web.json_response({"error": "nothing_to_branch"}, status=400)
    except Exception as exc:  # noqa: BLE001
        logger.exception("branch_session failed")
        return web.json_response({"error": "db_error", "detail": str(exc)}, status=500)
    return web.json_response({"session_id": new_id, "title": title, "messages": copied})


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
        "user_input": snap.get("user_input", ""),
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
