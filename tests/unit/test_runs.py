"""Unit tests for server/runs.py — delta callback events and history loading."""

from __future__ import annotations

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Shared helpers


class _FakeWSManager:
    """Captures every ``broadcast_threadsafe`` / ``broadcast`` call."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def broadcast_threadsafe(self, channel: str, payload: dict[str, Any]) -> None:
        self.calls.append((channel, payload))

    async def broadcast(self, channel: str, payload: dict[str, Any]) -> None:
        self.calls.append((channel, payload))

    def events(self) -> list[str]:
        return [p.get("event", "") for _, p in self.calls]


def _make_fake_shim(captured_callbacks: dict[str, Any]) -> MagicMock:
    class FakeAIAgent:
        session_prompt_tokens: int = 0
        session_completion_tokens: int = 0
        session_total_tokens: int = 0

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            for key in (
                "stream_delta_callback",
                "tool_start_callback",
                "tool_complete_callback",
                "reasoning_callback",
                "session_db",
            ):
                captured_callbacks[key] = kwargs.get(key)

        def run_conversation(self, **kwargs: Any) -> dict[str, Any]:
            return {"final_response": "", "messages": []}

    shim = MagicMock()
    shim.gateway.GatewayRunner = MagicMock()          # must not be None
    shim.gateway.load_gateway_config = MagicMock(return_value={})
    shim.gateway.resolve_gateway_model = MagicMock(return_value="test-model")
    shim.gateway.resolve_runtime_agent_kwargs = MagicMock(return_value={})
    shim.gateway.get_platform_tools = MagicMock(return_value=[])
    shim.gateway.load_reasoning_config = None          # optional
    shim.gateway.load_fallback_model = None            # optional
    shim.run_agent.AIAgent = FakeAIAgent
    shim.run_agent.parse_reasoning_effort = None       # optional
    return shim


def _make_delta_callback(
    run_id: str = "run-xyz",
) -> tuple[Any, _FakeWSManager]:
    from server.runs import _build_agent

    captured: dict[str, Any] = {}
    fake_ws = _FakeWSManager()
    fake_shim = _make_fake_shim(captured)

    from server.runs import RunHandle
    handle = RunHandle(
        run_id=run_id,
        session_id="sess-abc",
        status="running",
        created_at=0.0,
    )

    with (
        patch("server.runs.shim", fake_shim),
        patch("server.runs.get_ws_manager", return_value=fake_ws),
        patch("server.runs.db"),  # called inside AIAgent init kwargs
    ):
        _build_agent(
            handle=handle,
            reasoning_effort=None,
            loop=asyncio.new_event_loop(),
        )

    cb = captured.get("stream_delta_callback")
    assert cb is not None, "stream_delta_callback was not passed to AIAgent"
    return cb, fake_ws


# _on_delta tests


def test_on_delta_none_broadcasts_stream_reset() -> None:
    cb, fake_ws = _make_delta_callback("run-r1")
    cb(None)
    assert "stream.reset" in fake_ws.events()


def test_on_delta_stream_reset_includes_run_id() -> None:
    cb, fake_ws = _make_delta_callback("run-check")
    cb(None)
    reset_frames = [p for _, p in fake_ws.calls if p.get("event") == "stream.reset"]
    assert len(reset_frames) == 1
    assert reset_frames[0]["run_id"] == "run-check"


def test_on_delta_empty_string_is_dropped() -> None:
    cb, fake_ws = _make_delta_callback("run-r2")
    cb("")
    assert len(fake_ws.calls) == 0, "expected no broadcast for empty delta"


def test_on_delta_text_broadcasts_message_delta() -> None:
    cb, fake_ws = _make_delta_callback("run-r3")
    cb("hello world")
    assert len(fake_ws.calls) == 1
    _channel, payload = fake_ws.calls[0]
    assert payload["event"] == "message.delta"
    assert payload["delta"] == "hello world"
    assert payload["run_id"] == "run-r3"


def test_on_delta_none_does_not_broadcast_message_delta() -> None:
    cb, fake_ws = _make_delta_callback("run-r4")
    cb(None)
    assert "message.delta" not in fake_ws.events()


def test_on_delta_multiple_texts_accumulate() -> None:
    cb, fake_ws = _make_delta_callback("run-r5")
    cb("chunk1")
    cb("chunk2")
    cb("chunk3")
    events = fake_ws.events()
    assert events.count("message.delta") == 3
    deltas = [p["delta"] for _, p in fake_ws.calls]
    assert deltas == ["chunk1", "chunk2", "chunk3"]


# _build_agent + _maybe_auto_title: profile-scoped session DB


def _build_with_profile(
    profile: str | None, *, home: object | None
) -> tuple[Any, object, object, Any]:
    """Build an agent under a fake shim and return the ``session_db`` it handed
    to ``AIAgent``. ``home`` is what ``resolve_profile_home`` yields for this
    run (``None`` → default home → the shared singleton)."""
    from server.runs import RunHandle, _build_agent

    captured: dict[str, Any] = {}
    fake_shim = _make_fake_shim(captured)
    handle = RunHandle(
        run_id="run-prof",
        session_id="sess-prof",
        status="running",
        created_at=0.0,
        profile=profile,
    )
    default_db, profile_db = object(), object()
    with (
        patch("server.runs.shim", fake_shim),
        patch("server.runs.get_ws_manager", return_value=_FakeWSManager()),
        patch("server.runs.resolve_profile_home", return_value=home),
        patch("server.runs.db", return_value=default_db),
        patch("server.runs.db_for_home", return_value=profile_db) as m_home,
    ):
        _build_agent(handle=handle, reasoning_effort=None, loop=asyncio.new_event_loop())
    return captured.get("session_db"), default_db, profile_db, m_home


def test_build_agent_named_profile_persists_to_profile_db() -> None:
    # A named profile must read/write its OWN state.db, not the default home's.
    home = object()  # stand-in for the profile's resolved HERMES_HOME
    session_db, _default_db, profile_db, m_home = _build_with_profile("creative", home=home)
    assert session_db is profile_db
    m_home.assert_called_once_with(home)


def test_build_agent_default_profile_uses_default_db() -> None:
    session_db, default_db, _profile_db, m_home = _build_with_profile(None, home=None)
    assert session_db is default_db
    m_home.assert_not_called()


def test_auto_title_named_profile_writes_to_profile_db(monkeypatch) -> None:
    """The auto-title write follows the run's profile too (else titles land in
    the default DB while the session lives in the profile's)."""
    import sys
    import types

    from server.runs import _maybe_auto_title

    captured: dict[str, Any] = {}
    fake_mod = types.ModuleType("agent.title_generator")
    fake_mod.maybe_auto_title = lambda session_db, *a, **k: captured.__setitem__("db", session_db)
    monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
    monkeypatch.setitem(sys.modules, "agent.title_generator", fake_mod)

    home = object()
    default_db, profile_db = object(), object()
    monkeypatch.setattr("server.runs.resolve_profile_home", lambda p: home)
    monkeypatch.setattr("server.runs.db", lambda: default_db)
    monkeypatch.setattr("server.runs.db_for_home", lambda h: profile_db)

    _maybe_auto_title(
        agent=MagicMock(),
        session_id="s",
        user_message="u",
        assistant_response="a",
        conversation_history=[],
        profile="creative",
    )
    assert captured["db"] is profile_db


# _run_to_completion: history loading


@pytest.mark.asyncio
async def test_history_loaded_from_db_when_not_provided(
    quiet_hms_env,
) -> None:
    """When ``conversation_history=[]``, history is fetched from the session DB."""
    from server.runs import RunHandle, _run_to_completion

    session_id = "sess-hist"
    run_id = "run-hist"
    stored_history = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]

    mock_session_db = MagicMock()
    mock_session_db.get_messages_as_conversation.return_value = stored_history

    captured_history: list[dict[str, Any]] = []

    class FakeAIAgentWithHistoryCapture:
        session_prompt_tokens: int = 0
        session_completion_tokens: int = 0
        session_total_tokens: int = 0

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def run_conversation(self, **kwargs: Any) -> dict[str, Any]:
            captured_history.extend(kwargs.get("conversation_history", []))
            return {"final_response": "ok", "messages": []}

    captured_cbs: dict[str, Any] = {}
    fake_shim = _make_fake_shim(captured_cbs)
    fake_shim.run_agent.AIAgent = FakeAIAgentWithHistoryCapture

    fake_ws = _FakeWSManager()

    mock_registry = AsyncMock()
    mock_registry.remove = AsyncMock()

    mock_bridge = MagicMock()
    mock_bridge.register = MagicMock()
    mock_bridge.unregister = MagicMock()
    mock_bridge.bind_session_key = MagicMock(return_value=None)
    mock_bridge.unbind_session_key = MagicMock()

    handle = RunHandle(
        run_id=run_id,
        session_id=session_id,
        status="queued",
        created_at=time.time(),
        model=None,
    )

    loop = asyncio.get_event_loop()
    with (
        patch("server.runs.shim", fake_shim),
        patch("server.runs.get_ws_manager", return_value=fake_ws),
        patch("server.runs.db", return_value=mock_session_db),
        patch("server.runs.get_registry", return_value=mock_registry),
        patch("server.runs.get_approval_bridge", return_value=mock_bridge),
        patch("server.runs._maybe_auto_title"),
        # These tests assert raw history handling; the workspace preface is
        # exercised separately, so suppress it (also avoids creating ~/workspace).
        patch("server.runs._workspace_context_history", return_value=[]),
    ):
        await _run_to_completion(
            handle=handle,
            input_data="hello",
            reasoning_effort=None,
            conversation_history=[],
            sem=asyncio.Semaphore(1),
            loop=loop,
        )

    mock_session_db.get_messages_as_conversation.assert_called_once_with(session_id)
    assert captured_history == stored_history


@pytest.mark.asyncio
async def test_history_not_fetched_when_provided(
    quiet_hms_env,
) -> None:
    """When a non-empty ``conversation_history`` is supplied, the DB is not queried."""
    from server.runs import RunHandle, _run_to_completion

    session_id = "sess-skip"
    run_id = "run-skip"
    prefilled = [{"role": "user", "content": "pre-existing"}]

    mock_session_db = MagicMock()
    mock_session_db.get_messages_as_conversation.return_value = []

    class FakeAIAgentNoDb:
        session_prompt_tokens: int = 0
        session_completion_tokens: int = 0
        session_total_tokens: int = 0

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def run_conversation(self, **kwargs: Any) -> dict[str, Any]:
            return {"final_response": "ok", "messages": []}

    captured_cbs: dict[str, Any] = {}
    fake_shim = _make_fake_shim(captured_cbs)
    fake_shim.run_agent.AIAgent = FakeAIAgentNoDb

    fake_ws = _FakeWSManager()
    mock_registry = AsyncMock()
    mock_registry.remove = AsyncMock()
    mock_bridge = MagicMock()
    mock_bridge.register = MagicMock()
    mock_bridge.unregister = MagicMock()
    mock_bridge.bind_session_key = MagicMock(return_value=None)
    mock_bridge.unbind_session_key = MagicMock()

    handle = RunHandle(
        run_id=run_id,
        session_id=session_id,
        status="queued",
        created_at=time.time(),
        model=None,
    )

    loop = asyncio.get_event_loop()
    with (
        patch("server.runs.shim", fake_shim),
        patch("server.runs.get_ws_manager", return_value=fake_ws),
        patch("server.runs.db", return_value=mock_session_db),
        patch("server.runs.get_registry", return_value=mock_registry),
        patch("server.runs.get_approval_bridge", return_value=mock_bridge),
        patch("server.runs._maybe_auto_title"),
        # These tests assert raw history handling; the workspace preface is
        # exercised separately, so suppress it (also avoids creating ~/workspace).
        patch("server.runs._workspace_context_history", return_value=[]),
    ):
        await _run_to_completion(
            handle=handle,
            input_data="hello",
            reasoning_effort=None,
            conversation_history=prefilled,  # already provided
            sem=asyncio.Semaphore(1),
            loop=loop,
        )

    mock_session_db.get_messages_as_conversation.assert_not_called()


# ── Per-run frame seq + replay ring ───────────────────────────────────


def _new_handle(run_id: str = "run-seq"):
    from server.runs import RunHandle
    return RunHandle(run_id=run_id, session_id="sess", status="running", created_at=time.time())


def test_stamp_assigns_monotonic_seq_and_buffers() -> None:
    h = _new_handle()
    f1 = h.stamp({"event": "message.delta", "delta": "a"})
    f2 = h.stamp({"event": "message.delta", "delta": "b"})
    f3 = h.stamp({"event": "run.completed"})
    assert [f1["seq"], f2["seq"], f3["seq"]] == [1, 2, 3]
    # All buffered in order.
    assert [f["seq"] for f in h.ring] == [1, 2, 3]


def test_replay_since_returns_only_newer_frames() -> None:
    h = _new_handle()
    for ch in "abc":
        h.stamp({"event": "message.delta", "delta": ch})
    # Client saw up to seq=2 → only the third frame should replay.
    replayed = h.replay_since(2)
    assert [f["seq"] for f in replayed] == [3]
    # last_seq=0 (fresh re-subscribe) replays everything still buffered.
    assert [f["seq"] for f in h.replay_since(0)] == [1, 2, 3]


def test_ring_is_bounded() -> None:
    from server.runs import RUN_RING_MAX
    h = _new_handle()
    for _ in range(RUN_RING_MAX + 50):
        h.stamp({"event": "message.delta"})
    assert len(h.ring) == RUN_RING_MAX
    # seq keeps climbing past the buffer cap; oldest frames are evicted.
    assert h.seq == RUN_RING_MAX + 50
    assert h.ring[0]["seq"] == 51


# ── Shared terminal-frame contract across run paths ───────────────────
# These guard D1 (contract unification) + D2 (status vocabulary). The slash
# path is patched at _build_hms_event so it runs without the agent venv.


@pytest.mark.asyncio
async def test_slash_run_success_emits_completed_with_session_id(quiet_hms_env) -> None:
    from server import runs as runs_mod
    from server.runs import start_slash_run

    runs_mod.reset_for_test()
    fake_ws = _FakeWSManager()
    adapter = MagicMock()
    adapter._message_handler = AsyncMock(return_value="pong")

    with (
        patch("server.runs.get_ws_manager", return_value=fake_ws),
        patch("server.runs._build_hms_event", return_value=object()),
    ):
        handle = await start_slash_run(adapter=adapter, text="/help", session_id="sess-1")
        await handle.task

    assert handle.status == "completed"
    events = fake_ws.events()
    assert "message.delta" in events
    assert "run.completed" in events
    completed = next(p for _, p in fake_ws.calls if p.get("event") == "run.completed")
    # Terminal frame carries session_id (shared _terminal_frame contract).
    assert completed["session_id"] == "sess-1"
    assert completed["output"] == "pong"
    # Every frame is seq-stamped via the shared stamp/_terminal_frame path.
    assert all("seq" in p for _, p in fake_ws.calls)


@pytest.mark.asyncio
async def test_slash_run_failure_uses_failed_not_error(quiet_hms_env) -> None:
    """Regression for D2: the slash path must emit the canonical ``failed``
    status, not the legacy ``error`` spelling that diverged from the AIAgent
    path."""
    from server import runs as runs_mod
    from server.runs import start_slash_run

    runs_mod.reset_for_test()
    fake_ws = _FakeWSManager()
    adapter = MagicMock()
    adapter._message_handler = AsyncMock(side_effect=RuntimeError("boom"))

    with (
        patch("server.runs.get_ws_manager", return_value=fake_ws),
        patch("server.runs._build_hms_event", return_value=object()),
    ):
        handle = await start_slash_run(adapter=adapter, text="/broken", session_id="sess-2")
        await handle.task

    assert handle.status == "failed"  # NOT "error"
    failed = next(p for _, p in fake_ws.calls if p.get("event") == "run.failed")
    assert failed["session_id"] == "sess-2"
    assert "boom" in failed["error"]


# RunHandle durable accumulator — in-flight turn survives ring eviction


def test_runhandle_accumulates_partial_turn() -> None:
    from server.runs import RunHandle

    h = RunHandle(run_id="r", session_id="s", status="running", created_at=0.0)
    h.stamp({"event": "message.delta", "delta": "Hello "})
    h.stamp({"event": "message.delta", "delta": "world"})
    h.stamp({"event": "reasoning.available", "text": "thinking"})
    h.stamp({"event": "tool.started", "tool_call_id": "t1", "tool": "shell", "preview": "ls"})
    h.stamp({"event": "tool.completed", "tool_call_id": "t1", "tool": "shell", "error": False})

    snap = h.partial_snapshot()
    assert snap["text"] == "Hello world"
    assert snap["reasoning"] == "thinking"
    assert snap["seq"] == 5
    assert snap["tool_calls"] == [
        {"tool_call_id": "t1", "tool": "shell", "preview": "ls", "status": "done"}
    ]


def test_runhandle_accumulator_survives_ring_eviction() -> None:
    """The replay ring is bounded; the accumulator is not — so a long run that
    overflowed the ring still hands a re-attaching client the whole partial."""
    from server.runs import RUN_RING_MAX, RunHandle

    h = RunHandle(run_id="r", session_id="s", status="running", created_at=0.0)
    for _ in range(RUN_RING_MAX + 50):
        h.stamp({"event": "message.delta", "delta": "x"})
    # Ring kept only the last RUN_RING_MAX frames …
    assert len(h.replay_since(0)) == RUN_RING_MAX
    # … but the accumulated text has every delta.
    assert len(h.partial_snapshot()["text"]) == RUN_RING_MAX + 50


# GET /api/runs/{id}/transcript — re-attach replay channel

_VALID_RUN_ID = "run_" + "a" * 32


@pytest.mark.asyncio
async def test_transcript_endpoint_returns_partial() -> None:
    import json

    from aiohttp.test_utils import make_mocked_request
    from server import runs
    from server.routes.runs import get_run_transcript

    runs.reset_for_test()
    try:
        handle = runs.RunHandle(
            run_id=_VALID_RUN_ID, session_id="s", status="running", created_at=0.0,
        )
        handle.stamp({"event": "message.delta", "delta": "partial answer"})
        handle.stamp({"event": "tool.started", "tool_call_id": "t1", "tool": "shell", "preview": "ls"})
        await runs.get_registry().add(handle)

        req = make_mocked_request(
            "GET", f"/api/runs/{_VALID_RUN_ID}/transcript",
            match_info={"run_id": _VALID_RUN_ID},
        )
        resp = await get_run_transcript(req)
        assert resp.status == 200
        data = json.loads(resp.body)
        assert data["status"] == "running"
        assert data["seq"] == 2
        assert data["partial"]["text"] == "partial answer"
        assert data["partial"]["tool_calls"][0]["tool"] == "shell"
    finally:
        runs.reset_for_test()


@pytest.mark.asyncio
async def test_transcript_endpoint_404_for_unknown_run() -> None:
    from aiohttp.test_utils import make_mocked_request
    from server import runs
    from server.routes.runs import get_run_transcript

    runs.reset_for_test()
    req = make_mocked_request(
        "GET", f"/api/runs/{_VALID_RUN_ID}/transcript",
        match_info={"run_id": _VALID_RUN_ID},
    )
    resp = await get_run_transcript(req)
    assert resp.status == 404
