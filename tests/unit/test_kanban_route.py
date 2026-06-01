"""Kanban route tests — shim accessors patched with hand-rolled sqlite rows."""

from __future__ import annotations

import contextlib
import sqlite3
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.lib.upstream_shim import shim


def _fake_kanban_db(rows: list[dict]) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE tasks (
            id                   TEXT PRIMARY KEY,
            title                TEXT NOT NULL,
            body                 TEXT,
            assignee             TEXT,
            status               TEXT NOT NULL,
            priority             INTEGER DEFAULT 0,
            created_by           TEXT,
            created_at           INTEGER NOT NULL,
            started_at           INTEGER,
            completed_at         INTEGER,
            workspace_kind       TEXT DEFAULT 'scratch',
            workspace_path       TEXT,
            claim_lock           TEXT,
            claim_expires        INTEGER,
            tenant               TEXT,
            result               TEXT,
            consecutive_failures INTEGER DEFAULT 0,
            worker_pid           INTEGER,
            last_failure_error   TEXT,
            last_heartbeat_at    INTEGER
        )
    """)
    now = int(time.time())
    for r in rows:
        conn.execute(
            """
            INSERT INTO tasks
              (id, title, body, assignee, status, priority, created_at,
               workspace_kind, consecutive_failures)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'scratch', 0)
            """,
            (
                r["id"],
                r.get("title", "task"),
                r.get("body"),
                r.get("assignee"),
                r["status"],
                r.get("priority", 0),
                r.get("created_at", now),
            ),
        )
    conn.commit()
    return conn


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {
            "host": "127.0.0.1",
            "port": 3131,
        }}}}),
        encoding="utf-8",
    )
    from server.lib import config_reader
    config_reader.reload()

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    base = f"http://{host}:{port}"
    try:
        yield base
    finally:
        await runner.cleanup()
        config_reader.reload()


def _install_shim(conn: sqlite3.Connection, valid_statuses=None, *, with_helpers=True):
    """Patch shim.kanban.* with callables backed by the supplied conn.

    ``with_helpers=True`` (default) installs faithful re-implementations
    of ``complete_task`` / ``block_task`` / ``unblock_task`` /
    ``archive_task`` so route transitions exercise the upstream-aligned
    code path. Pass ``False`` to fall back to raw UPDATE (legacy path).
    """
    if valid_statuses is None:
        valid_statuses = frozenset({
            "triage", "todo", "ready", "running", "blocked", "done", "archived",
        })

    def list_tasks(c, *, include_archived=False, **_kw):
        sql = "SELECT * FROM tasks"
        if not include_archived:
            sql += " WHERE status != 'archived'"
        rows = c.execute(sql).fetchall()
        return rows

    def get_task(c, task_id):
        return c.execute(
            "SELECT * FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()

    @contextlib.contextmanager
    def write_txn(c):
        yield c

    # Upstream-aligned transition fakes
    import time as _t

    def complete_task(c, task_id, *, result=None, **_):
        cur = c.execute(
            """
            UPDATE tasks
               SET status = 'done',
                   completed_at = ?,
                   result = COALESCE(?, result)
             WHERE id = ?
               AND status IN ('ready', 'running')
            """,
            (int(_t.time()), result, task_id),
        )
        return cur.rowcount > 0

    def block_task(c, task_id, *, reason=None, **_):
        cur = c.execute(
            """
            UPDATE tasks
               SET status = 'blocked',
                   claim_lock = NULL,
                   claim_expires = NULL,
                   worker_pid = NULL,
                   last_failure_error = COALESCE(?, last_failure_error)
             WHERE id = ?
               AND status IN ('running', 'ready')
            """,
            (reason, task_id),
        )
        return cur.rowcount > 0

    def unblock_task(c, task_id):
        cur = c.execute(
            "UPDATE tasks SET status = 'ready' WHERE id = ? AND status = 'blocked'",
            (task_id,),
        )
        return cur.rowcount > 0

    def archive_task(c, task_id):
        cur = c.execute(
            """
            UPDATE tasks
               SET status = 'archived',
                   claim_lock = NULL,
                   claim_expires = NULL,
                   worker_pid = NULL
             WHERE id = ?
               AND status != 'archived'
            """,
            (task_id,),
        )
        return cur.rowcount > 0

    helpers_attrs: dict = {}
    if with_helpers:
        helpers_attrs = dict(
            complete_task=MagicMock(side_effect=complete_task),
            block_task=MagicMock(side_effect=block_task),
            unblock_task=MagicMock(side_effect=unblock_task),
            archive_task=MagicMock(side_effect=archive_task),
        )
    else:
        helpers_attrs = dict(
            complete_task=None,
            block_task=None,
            unblock_task=None,
            archive_task=None,
        )

    return patch.multiple(
        shim.kanban,
        connect=MagicMock(return_value=conn),
        list_tasks=MagicMock(side_effect=list_tasks),
        get_task=MagicMock(side_effect=get_task),
        list_boards=MagicMock(return_value=[
            {"slug": "default", "display_name": "Default"},
            {"slug": "atm10-server", "display_name": "ATM10 Server"},
        ]),
        get_current_board=MagicMock(return_value="default"),
        write_txn=MagicMock(side_effect=write_txn),
        VALID_STATUSES=valid_statuses,
        **helpers_attrs,
    )


@pytest.mark.asyncio
async def test_boards_list(app_server):
    conn = _fake_kanban_db([])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/kanban/boards") as r:
                assert r.status == 200
                data = await r.json()

    assert data["current"] == "default"
    slugs = [b["slug"] for b in data["boards"]]
    assert "default" in slugs
    assert "atm10-server" in slugs


@pytest.mark.asyncio
async def test_boards_unavailable(app_server):
    """When the shim isn't wired (upstream missing) → graceful empty list."""
    with patch.multiple(
        shim.kanban,
        connect=None,
        list_tasks=None,
    ):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/kanban/boards") as r:
                assert r.status == 200
                data = await r.json()

    assert data["boards"] == []
    assert data["error"] == "kanban_unavailable"


@pytest.mark.asyncio
async def test_board_tasks_groups_by_status(app_server):
    now = int(time.time())
    conn = _fake_kanban_db([
        {"id": "t1", "status": "todo", "created_at": now},
        {"id": "t2", "status": "ready", "created_at": now},
        {"id": "t3", "status": "ready", "created_at": now - 2 * 3600},  # stranded
        {"id": "t4", "status": "running", "created_at": now},
        {"id": "t5", "status": "done", "created_at": now},
        {"id": "arch", "status": "archived", "created_at": now},
    ])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/kanban/board/default/tasks") as r:
                assert r.status == 200
                data = await r.json()

    assert data["board"] == "default"
    # archived should be excluded by default
    assert len(data["tasks"]) == 5
    by_status = data["by_status"]
    assert len(by_status["todo"]) == 1
    assert len(by_status["ready"]) == 2
    assert len(by_status["running"]) == 1
    assert len(by_status["done"]) == 1
    # The 2h-old "ready" task should be counted as stranded
    assert data["stranded_in_ready"] == 1


@pytest.mark.asyncio
async def test_board_tasks_include_archived(app_server):
    conn = _fake_kanban_db([
        {"id": "t1", "status": "todo"},
        {"id": "arch", "status": "archived"},
    ])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.get(
                f"{app_server}/api/kanban/board/default/tasks?include_archived=1"
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert len(data["tasks"]) == 2


@pytest.mark.asyncio
async def test_set_task_status_raw_transition_succeeds(app_server):
    """``todo -> ready`` has no upstream helper; raw UPDATE applies."""
    conn = _fake_kanban_db([
        {"id": "t1", "status": "todo"},
    ])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "ready"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["ok"] is True
    assert data["task"]["status"] == "ready"


@pytest.mark.asyncio
async def test_set_task_status_running_target_rejected(app_server):
    """Target=running is forbidden — claim semantics belong to dispatcher."""
    conn = _fake_kanban_db([{"id": "t1", "status": "todo"}])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "running"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 400
                data = await r.json()
                assert data["error"] == "running_requires_dispatcher"


@pytest.mark.asyncio
async def test_running_to_ready_blocked(app_server):
    """``running -> ready`` has no helper and raw fallback's
    ``WHERE status != 'running'`` guard blocks the write."""
    conn = _fake_kanban_db([{"id": "t1", "status": "running"}])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "ready"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 409
                data = await r.json()
                assert data["error"] == "task_locked_or_missing"


@pytest.mark.asyncio
async def test_complete_task_from_ready(app_server):
    """``ready -> done`` routes through ``complete_task`` helper."""
    conn = _fake_kanban_db([{"id": "t1", "status": "ready"}])
    with _install_shim(conn) as p:
        # We can't directly observe the patched MagicMock from within the
        # ``patch.multiple`` context manager via the loop variable, so we
        # just assert the side-effects on the DB.
        del p
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "done"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["task"]["status"] == "done"
    assert isinstance(data["task"]["completed_at"], int)


@pytest.mark.asyncio
async def test_complete_task_from_running(app_server):
    """Upstream allows ``running -> done`` via complete_task. We mirror it."""
    conn = _fake_kanban_db([{"id": "t1", "status": "running"}])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "done"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["task"]["status"] == "done"


@pytest.mark.asyncio
async def test_complete_task_from_todo_rejected(app_server):
    """``complete_task`` only accepts ready|running source — todo is rejected."""
    conn = _fake_kanban_db([{"id": "t1", "status": "todo"}])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "done"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 409
                data = await r.json()
                assert data["error"] == "task_locked_or_missing"


@pytest.mark.asyncio
async def test_block_task_from_running(app_server):
    """``running -> blocked`` via block_task with optional reason."""
    conn = _fake_kanban_db([{"id": "t1", "status": "running"}])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "blocked", "reason": "waiting on review"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["task"]["status"] == "blocked"
    assert data["task"]["last_failure_error"] == "waiting on review"


@pytest.mark.asyncio
async def test_unblock_task(app_server):
    """``blocked -> ready`` uses unblock_task."""
    conn = _fake_kanban_db([{"id": "t1", "status": "blocked"}])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "ready"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["task"]["status"] == "ready"


@pytest.mark.asyncio
async def test_archive_task(app_server):
    """Any non-archived state can transition to archived."""
    conn = _fake_kanban_db([{"id": "t1", "status": "done"}])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "archived"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["task"]["status"] == "archived"


@pytest.mark.asyncio
async def test_set_task_status_invalid_status(app_server):
    conn = _fake_kanban_db([{"id": "t1", "status": "todo"}])
    with _install_shim(conn):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "made-up"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 400
                data = await r.json()
                assert data["error"] == "invalid_status"


@pytest.mark.asyncio
async def test_legacy_raw_path_still_works(app_server):
    """When upstream helpers aren't exposed (older agent), the route
    falls back to raw UPDATE for done too. Verifies the fallback path."""
    conn = _fake_kanban_db([{"id": "t1", "status": "todo"}])
    with _install_shim(conn, with_helpers=False):
        async with aiohttp.ClientSession() as cs:
            async with cs.put(
                f"{app_server}/api/kanban/tasks/t1/status",
                json={"board": "default", "status": "done"},
                headers={"X-HMS-CSRF": "1", "Content-Type": "application/json"},
            ) as r:
                assert r.status == 200
                data = await r.json()

    assert data["task"]["status"] == "done"
