"""Kanban panel backend — board list/tasks + safe non-running column moves."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import sqlite3
import time
from dataclasses import asdict, is_dataclass
from typing import Any

from aiohttp import web

from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)

router = web.RouteTableDef()


def _to_dict(obj: Any) -> dict[str, Any]:
    if is_dataclass(obj) and not isinstance(obj, type):
        return asdict(obj)
    if isinstance(obj, dict):
        return dict(obj)
    try:
        # obj is a Row-like mapping here; reset to Any so the subscript/keys()
        # access isn't blocked by the is_dataclass/isinstance narrowing above.
        d: Any = obj
        return {k: d[k] for k in d.keys()}
    except Exception:
        return {"value": str(obj)}


def _kanban_available() -> tuple[bool, str | None]:
    if shim.kanban.connect is None or shim.kanban.list_tasks is None:
        return False, "kanban_unavailable"
    return True, None


def _run_sync(fn, *args, **kwargs):
    loop = asyncio.get_running_loop()
    return loop.run_in_executor(None, lambda: fn(*args, **kwargs))


@router.get("/api/kanban/boards")
async def list_boards(request: web.Request) -> web.Response:
    ok, reason = _kanban_available()
    if not ok:
        return web.json_response(
            {"boards": [], "current": "default", "error": reason},
        )

    def _query():
        list_fn = shim.kanban.list_boards
        get_current = shim.kanban.get_current_board
        boards: list[Any] = []
        if callable(list_fn):
            try:
                boards = list_fn(include_archived=False) or []
            except Exception:
                logger.exception("[hms.kanban] list_boards failed")
                boards = []
        current = "default"
        if callable(get_current):
            try:
                current = get_current() or "default"
            except Exception:
                logger.exception("[hms.kanban] get_current_board failed")
        return {
            "boards": [_to_dict(b) for b in boards],
            "current": current,
        }

    try:
        payload = await _run_sync(_query)
    except Exception as exc:
        logger.warning("[hms.kanban] list_boards: %s", exc)
        return web.json_response({"boards": [], "current": "default", "error": "db_error"})
    return web.json_response(payload)


@router.get("/api/kanban/board/{slug}/tasks")
async def board_tasks(request: web.Request) -> web.Response:
    ok, reason = _kanban_available()
    if not ok:
        return web.json_response(
            {"tasks": [], "by_status": {}, "error": reason},
        )

    slug = request.match_info["slug"]
    include_archived = request.query.get("include_archived", "").lower() in ("1", "true", "yes")

    connect = shim.kanban.connect
    list_tasks = shim.kanban.list_tasks
    if connect is None or list_tasks is None:
        return web.json_response({"error": "kanban_unavailable"}, status=503)

    def _query():
        conn = connect(board=slug)
        try:
            with contextlib.closing(conn):
                tasks = list_tasks(conn, include_archived=include_archived) or []
                return [_to_dict(t) for t in tasks]
        except sqlite3.Error as exc:
            logger.warning("[hms.kanban] read failed for board=%r: %s", slug, exc)
            raise

    try:
        rows = await _run_sync(_query)
    except Exception:
        return web.json_response(
            {"tasks": [], "by_status": {}, "error": "db_error", "board": slug},
        )

    by_status: dict[str, list[dict]] = {}
    for r in rows:
        st = (r.get("status") or "todo").lower()
        by_status.setdefault(st, []).append(r)

    # Stranded-in-ready diagnostic for v0.14 cron.
    one_hour_ago = time.time() - 3600
    stranded_count = 0
    for r in by_status.get("ready", []):
        created_at = r.get("created_at")
        if isinstance(created_at, (int, float)) and created_at < one_hour_ago:
            stranded_count += 1

    tenants = sorted({r["tenant"] for r in rows if r.get("tenant")})

    return web.json_response({
        "board": slug,
        "tasks": rows,
        "by_status": by_status,
        "tenants": tenants,
        "stranded_in_ready": stranded_count,
    })


@router.put("/api/kanban/tasks/{task_id}/status")
async def set_task_status(request: web.Request) -> web.Response:
    """Move a task between columns; running is dispatcher-only (claim_lock semantics)."""
    ok, reason = _kanban_available()
    if not ok:
        return web.json_response({"error": reason}, status=503)

    task_id = request.match_info["task_id"]
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json_required"}, status=400)

    board = (body.get("board") or "default").strip()
    new_status = (body.get("status") or "").strip().lower()
    reason_text = body.get("reason") or None
    if not new_status:
        return web.json_response({"error": "status_required"}, status=400)

    valid = shim.kanban.VALID_STATUSES
    if valid is not None and new_status not in valid:
        return web.json_response(
            {"error": "invalid_status", "valid": sorted(valid)},
            status=400,
        )
    if new_status == "running":
        return web.json_response(
            {
                "error": "running_requires_dispatcher",
                "hint": "Use the dispatcher / `hermes kanban claim` — the panel "
                        "cannot acquire the claim_lock safely.",
            },
            status=400,
        )

    connect = shim.kanban.connect
    if connect is None:
        return web.json_response({"error": "kanban_unavailable"}, status=503)
    write_txn = shim.kanban.write_txn
    if write_txn is None:
        write_txn = contextlib.nullcontext  # type: ignore[assignment]

    def _apply():
        conn = connect(board=board)
        with contextlib.closing(conn):
            success = _apply_transition(conn, task_id, new_status, reason_text, write_txn)
            if not success:
                return None
            return shim.kanban.get_task(conn, task_id) if shim.kanban.get_task else None

    try:
        updated = await _run_sync(_apply)
    except Exception as exc:
        logger.warning("[hms.kanban] set_task_status failed: %s", exc)
        return web.json_response({"error": "db_error", "detail": str(exc)}, status=500)

    if updated is None:
        return web.json_response(
            {
                "error": "task_locked_or_missing",
                "hint": "task is either running (locked by dispatcher), "
                        "in an incompatible source status for this transition, "
                        "or doesn't exist on this board",
            },
            status=409,
        )

    return web.json_response({"ok": True, "task": _to_dict(updated)})


def _apply_transition(conn, task_id: str, new_status: str, reason: Any, write_txn) -> bool:
    """Returns False when source status didn't match the helper's requirement (→ 409)."""
    # Helper-backed: emit task_events + handle run closure.
    if new_status == "done" and shim.kanban.complete_task is not None:
        result_text = reason if isinstance(reason, str) else None
        return bool(shim.kanban.complete_task(conn, task_id, result=result_text))

    if new_status == "blocked" and shim.kanban.block_task is not None:
        return bool(shim.kanban.block_task(conn, task_id, reason=reason))

    if new_status == "archived" and shim.kanban.archive_task is not None:
        return bool(shim.kanban.archive_task(conn, task_id))

    # unblock_task only handles blocked → ready.
    if new_status == "ready" and shim.kanban.unblock_task is not None:
        row = conn.execute(
            "SELECT status FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if row and row["status"] == "blocked":
            return bool(shim.kanban.unblock_task(conn, task_id))

    # Raw fallback for triage<->todo<->ready and reopens (no run state involved).
    with write_txn(conn):  # type: ignore[misc]
        cur = conn.execute(
            """
            UPDATE tasks
               SET status = ?
             WHERE id = ?
               AND status != 'running'
            """,
            (new_status, task_id),
        )
        return cur.rowcount > 0


@router.post("/api/kanban/board/{slug}/tasks")
async def create_task_route(request: web.Request) -> web.Response:
    ok, reason = _kanban_available()
    if not ok or shim.kanban.create_task is None:
        return web.json_response({"error": reason or "kanban_unavailable"}, status=503)
    slug = request.match_info["slug"]
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    title = body.get("title")
    if not isinstance(title, str) or not title.strip():
        return web.json_response({"error": "title_required"}, status=400)
    assignee = body.get("assignee") or None
    workspace_kind = body.get("workspace_kind") or "scratch"
    triage = bool(body.get("triage", False))
    skills = body.get("skills") or None
    parents = body.get("parents") or ()
    if skills is not None and not isinstance(skills, list):
        return web.json_response({"error": "invalid_skills"}, status=400)

    connect = shim.kanban.connect
    create = shim.kanban.create_task
    if connect is None or create is None:
        return web.json_response({"error": "kanban_unavailable"}, status=503)

    def _create():
        conn = connect(board=slug)
        with contextlib.closing(conn):
            return create(
                conn,
                title=title.strip(),
                assignee=assignee,
                workspace_kind=workspace_kind,
                triage=triage,
                skills=skills,
                parents=parents,
                board=slug,
            )

    try:
        task_id = await _run_sync(_create)
    except Exception as exc:
        logger.exception("[hms.kanban] create_task failed")
        return web.json_response({"error": "create_failed", "detail": str(exc)}, status=500)
    return web.json_response({"ok": True, "task_id": task_id}, status=201)


@router.post("/api/kanban/boards")
async def create_board_route(request: web.Request) -> web.Response:
    create_board = shim.kanban.create_board
    if create_board is None:
        return web.json_response({"error": "kanban_unavailable"}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    slug = body.get("slug")
    if not isinstance(slug, str) or not slug.strip():
        return web.json_response({"error": "slug_required"}, status=400)
    name = body.get("name") or None

    def _create():
        return create_board(slug.strip(), name=name)

    try:
        meta = await _run_sync(_create)
    except ValueError as exc:
        return web.json_response({"error": "invalid_slug", "detail": str(exc)}, status=400)
    except Exception as exc:
        logger.exception("[hms.kanban] create_board failed")
        return web.json_response({"error": "create_failed", "detail": str(exc)}, status=500)
    return web.json_response({"ok": True, "board": _to_dict(meta)}, status=201)


@router.post("/api/kanban/board/{slug}/nudge")
async def nudge_dispatcher(request: web.Request) -> web.Response:
    """Recompute which tasks are ready so the dispatcher picks them up."""
    ok, reason = _kanban_available()
    if not ok:
        return web.json_response({"error": reason or "kanban_unavailable"}, status=503)
    slug = request.match_info["slug"]
    connect = shim.kanban.connect
    recompute = shim.kanban.recompute_ready
    if connect is None or recompute is None:
        return web.json_response({"error": "kanban_unavailable"}, status=503)

    def _nudge():
        conn = connect(board=slug)
        with contextlib.closing(conn):
            recompute(conn)

    try:
        await _run_sync(_nudge)
    except Exception as exc:
        logger.exception("[hms.kanban] nudge failed")
        return web.json_response({"error": "nudge_failed", "detail": str(exc)}, status=500)
    return web.json_response({"ok": True})


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
