"""Crash-recovery sidecar — write / orphan lookup / supersede / sweep, plus the
GET /api/sessions/{id}/interrupted recovery endpoint.

All paths route through ``run_snapshots_dir()`` which resolves under
``hermes_home()``; ``quiet_hms_env`` points that at a per-test tmp dir, so these
never touch a real ~/.hermes.
"""

from __future__ import annotations

import json
import time

import pytest
from server.lib import run_snapshot

_RUN_A = "run_" + "a" * 32
_RUN_B = "run_" + "b" * 32


def test_write_and_orphan_roundtrip(quiet_hms_env) -> None:
    run_snapshot.write(
        _RUN_A, "sess-1", {"text": "hi", "reasoning": "", "tool_calls": []},
        user_input="what is 2+2",
    )
    orphan = run_snapshot.orphan_for_session("sess-1")
    assert orphan is not None
    assert orphan["run_id"] == _RUN_A
    assert orphan["partial"]["text"] == "hi"
    assert orphan["user_input"] == "what is 2+2"  # user prompt recovered too


def test_orphan_none_for_unknown_session(quiet_hms_env) -> None:
    assert run_snapshot.orphan_for_session("nope") is None


def test_delete_removes_sidecar(quiet_hms_env) -> None:
    run_snapshot.write(_RUN_A, "sess-2", {"text": "x"})
    run_snapshot.delete(_RUN_A)
    assert run_snapshot.orphan_for_session("sess-2") is None


def test_orphan_returns_most_recent(quiet_hms_env) -> None:
    run_snapshot.write(_RUN_A, "sess-3", {"text": "old"})
    time.sleep(0.01)
    run_snapshot.write(_RUN_B, "sess-3", {"text": "new"})
    orphan = run_snapshot.orphan_for_session("sess-3")
    assert orphan is not None and orphan["run_id"] == _RUN_B


def test_delete_for_session_supersedes(quiet_hms_env) -> None:
    run_snapshot.write(_RUN_A, "sess-4", {"text": "x"})
    run_snapshot.write(_RUN_B, "sess-5", {"text": "z"})
    run_snapshot.delete_for_session("sess-4")
    assert run_snapshot.orphan_for_session("sess-4") is None
    assert run_snapshot.orphan_for_session("sess-5") is not None  # other session untouched


def test_sweep_removes_old_only(quiet_hms_env) -> None:
    run_snapshot.write(_RUN_A, "sess-6", {"text": "x"})
    assert run_snapshot.sweep(3600) == 0  # nothing old enough yet
    assert run_snapshot.sweep(0) >= 1  # everything older than 0s
    assert run_snapshot.orphan_for_session("sess-6") is None


# ── recovery endpoint ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_interrupted_endpoint_returns_orphan(quiet_hms_env) -> None:
    from aiohttp.test_utils import make_mocked_request
    from server import runs
    from server.routes.chat import get_session_interrupted

    runs.reset_for_test()
    run_snapshot.write(_RUN_A, "sess-x", {"text": "half answer", "reasoning": "", "tool_calls": []})
    req = make_mocked_request(
        "GET", "/api/sessions/sess-x/interrupted", match_info={"session_id": "sess-x"},
    )
    resp = await get_session_interrupted(req)
    data = json.loads(resp.body)
    assert data["run_id"] == _RUN_A
    assert data["partial"]["text"] == "half answer"


@pytest.mark.asyncio
async def test_interrupted_endpoint_null_when_none(quiet_hms_env) -> None:
    from aiohttp.test_utils import make_mocked_request
    from server import runs
    from server.routes.chat import get_session_interrupted

    runs.reset_for_test()
    req = make_mocked_request(
        "GET", "/api/sessions/sess-y/interrupted", match_info={"session_id": "sess-y"},
    )
    resp = await get_session_interrupted(req)
    assert json.loads(resp.body)["partial"] is None


@pytest.mark.asyncio
async def test_interrupted_endpoint_null_when_run_still_active(quiet_hms_env) -> None:
    """A snapshot whose run is still in the registry is resuming over WS, not
    crashed — the endpoint must not surface it as interrupted."""
    from aiohttp.test_utils import make_mocked_request
    from server import runs
    from server.routes.chat import get_session_interrupted

    runs.reset_for_test()
    run_snapshot.write(_RUN_A, "sess-z", {"text": "live"})
    handle = runs.RunHandle(run_id=_RUN_A, session_id="sess-z", status="running", created_at=0.0)
    await runs.get_registry().add(handle)
    req = make_mocked_request(
        "GET", "/api/sessions/sess-z/interrupted", match_info={"session_id": "sess-z"},
    )
    resp = await get_session_interrupted(req)
    assert json.loads(resp.body)["partial"] is None
    runs.reset_for_test()
