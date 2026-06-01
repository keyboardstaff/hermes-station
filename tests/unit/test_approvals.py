"""ApprovalBridge unit tests."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from server import approvals as approvals_mod
from server.approvals import APPROVAL_CHANNEL, VALID_CHOICES, ApprovalBridge
from server.ws import WSConnection, WSManager
from server.ws import reset_for_test as reset_ws

# Exercises the real upstream tools.approval contract (its internal queues /
# notify-cb tables / _ApprovalEntry). Skips cleanly where hermes-agent is
# absent (CI's clean container); runs locally under scripts/test.sh.
pytest.importorskip(
    "tools.approval",
    reason="requires upstream hermes-agent (tools.approval)",
)


class FakeWS:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.closed = False

    async def send_json(self, payload: dict) -> None:
        if self.closed:
            raise ConnectionResetError("closed")
        self.sent.append(payload)

    async def close(self, code: int = 0, message: bytes = b"") -> None:
        self.closed = True


@pytest.fixture(autouse=True)
def _reset():
    reset_ws()
    approvals_mod.reset_for_test()
    # Clear upstream module-level lookup tables.
    from tools import approval as A
    with A._lock:
        A._gateway_queues.clear()
        A._gateway_notify_cbs.clear()
    yield
    reset_ws()
    approvals_mod.reset_for_test()
    with A._lock:
        A._gateway_queues.clear()
        A._gateway_notify_cbs.clear()


def test_valid_choices_matches_upstream_doc() -> None:
    # Pinned: change requires audit of upstream tools/approval.py:1175-1187.
    assert VALID_CHOICES == ("once", "session", "always", "deny")


def test_resolve_rejects_unknown_choice() -> None:
    bridge = ApprovalBridge(ws=WSManager())
    with pytest.raises(ValueError):
        bridge.resolve("sess-x", "yolo")


@pytest.mark.asyncio
async def test_register_pushes_approval_to_global_channel_only() -> None:
    mgr = WSManager()
    mgr.bind_loop(asyncio.get_running_loop())
    bridge = ApprovalBridge(ws=mgr)

    # Only the global-channel subscriber should see the payload.
    global_ws = FakeWS()
    run_ws = FakeWS()
    g = WSConnection(global_ws, manager=mgr)  # type: ignore[arg-type]
    r = WSConnection(run_ws, manager=mgr)  # type: ignore[arg-type]
    g.subscribe(APPROVAL_CHANNEL)
    r.subscribe("run:abc123")
    await mgr.register(g)
    await mgr.register(r)

    bridge.register("sess-1", "abc123")

    # Drive the upstream-style invocation from a worker thread (this is
    # exactly how check_all_command_guards calls back into us).
    from tools import approval as A
    cb = A._gateway_notify_cbs["sess-1"]

    import threading
    def _trigger() -> None:
        cb({
            "command": "rm -rf /",
            "description": "dangerous filesystem command",
            "pattern_key": "rm_rf",
            "pattern_keys": ["rm_rf"],
        })
    t = threading.Thread(target=_trigger)
    t.start()
    t.join()

    # Let pump drain — short window since the run channel should
    # NEVER receive a frame, and we want to confirm that.
    for _ in range(25):
        if global_ws.sent:
            break
        await asyncio.sleep(0.02)

    assert len(global_ws.sent) == 1
    assert len(run_ws.sent) == 0, "approval.requested must not mirror onto run:<id>"
    assert global_ws.sent[0] == {
        "type": "approval.requested",
        "run_id": "abc123",
        "session_key": "sess-1",
        "command": "rm -rf /",
        "description": "dangerous filesystem command",
        "pattern_key": "rm_rf",
        "pattern_keys": ["rm_rf"],
    }


# unregister wakes blocked threads


def test_unregister_clears_cb_in_upstream() -> None:
    bridge = ApprovalBridge(ws=WSManager())
    bridge.register("sess-x", "rid")
    from tools import approval as A
    assert "sess-x" in A._gateway_notify_cbs
    bridge.unregister("sess-x")
    assert "sess-x" not in A._gateway_notify_cbs


# full resolve roundtrip


def test_resolve_unblocks_waiting_entry() -> None:
    from tools import approval as A
    bridge = ApprovalBridge(ws=WSManager())
    session_key = "sess-resolve"
    bridge.register(session_key, "rid")

    # Fake an entry the same way prompt_dangerous_approval would.
    entry = A._ApprovalEntry({
        "command": "rm -rf /",
        "pattern_key": "rm_rf",
        "pattern_keys": ["rm_rf"],
        "description": "dangerous",
    })
    with A._lock:
        A._gateway_queues.setdefault(session_key, []).append(entry)

    # Resolve as "once" — no allowlist write.
    resolved = bridge.resolve(session_key, "once")
    assert resolved == 1
    assert entry.event.is_set()
    assert entry.result == "once"


def test_resolve_returns_zero_when_nothing_pending() -> None:
    bridge = ApprovalBridge(ws=WSManager())
    # Race after timeout / duplicate click — both legitimate.
    assert bridge.resolve("never-existed", "once") == 0


# contextvar binding round trip


def test_bind_and_unbind_session_key() -> None:
    from tools.approval import get_current_session_key
    token = ApprovalBridge.bind_session_key("ctx-key-1")
    try:
        assert get_current_session_key() == "ctx-key-1"
    finally:
        ApprovalBridge.unbind_session_key(token)
    # After unbind we should not see the leaked value.
    assert get_current_session_key() != "ctx-key-1"
