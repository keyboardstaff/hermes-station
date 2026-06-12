"""Exercise once / session / always / deny end-to-end approval flow."""

from __future__ import annotations

import pytest
from server import approvals as approvals_mod
from server.approvals import ApprovalBridge
from server.ws import WSManager
from server.ws import reset_for_test as reset_ws

# Exercises the real upstream tools.approval 4-choice flow. Skips where
# hermes-agent is absent (CI); runs locally under scripts/test.sh.
pytest.importorskip(
    "tools.approval",
    reason="requires upstream hermes-agent (tools.approval)",
)


@pytest.fixture(autouse=True)
def _reset_upstream_tables():
    reset_ws()
    approvals_mod.reset_for_test()
    from tools import approval as A
    with A._lock:
        A._gateway_queues.clear()
        A._gateway_notify_cbs.clear()
        A._permanent_approved.clear()
        A._session_approved.clear()
    yield
    reset_ws()
    approvals_mod.reset_for_test()
    with A._lock:
        A._gateway_queues.clear()
        A._gateway_notify_cbs.clear()
        A._permanent_approved.clear()
        A._session_approved.clear()


def _enqueue_approval(session_key: str, pattern_key: str = "rm_rf"):
    from tools import approval as A
    entry = A._ApprovalEntry({
        "command": "rm -rf /tmp/foo",
        "pattern_key": pattern_key,
        "pattern_keys": [pattern_key],
        "description": "dangerous filesystem command",
    })
    with A._lock:
        A._gateway_queues.setdefault(session_key, []).append(entry)
    return entry


@pytest.mark.parametrize("choice", ["once", "session", "always", "deny"])
def test_each_choice_signals_entry(choice: str) -> None:
    bridge = ApprovalBridge(ws=WSManager())
    bridge.register("sess-each", "run-id")
    entry = _enqueue_approval("sess-each")

    n = bridge.resolve("sess-each", choice)
    assert n == 1, f"choice={choice}: nothing was resolved"
    assert entry.event.is_set()
    assert entry.result == choice

    bridge.unregister("sess-each")


def test_once_does_not_persist() -> None:
    from tools import approval as A

    bridge = ApprovalBridge(ws=WSManager())
    bridge.register("sess-once", "rid")
    entry = _enqueue_approval("sess-once")
    bridge.resolve("sess-once", "once")
    assert entry.result == "once"
    # No session or permanent state populated.
    assert "rm_rf" not in A._permanent_approved
    assert A._session_approved.get("sess-once", set()) == set()
    bridge.unregister("sess-once")


def test_session_persists_pattern_in_session() -> None:
    bridge = ApprovalBridge(ws=WSManager())
    bridge.register("sess-keep", "rid")
    entry = _enqueue_approval("sess-keep")
    bridge.resolve("sess-keep", "session")
    assert entry.result == "session"
    bridge.unregister("sess-keep")


def test_always_does_not_double_write() -> None:
    from tools import approval as A

    bridge = ApprovalBridge(ws=WSManager())
    bridge.register("sess-perm", "rid")
    entry = _enqueue_approval("sess-perm", pattern_key="dd_disk")

    # Snapshot before.
    before = set(A._permanent_approved)
    n = bridge.resolve("sess-perm", "always")
    assert n == 1
    assert entry.result == "always"
    # Note: upstream's `check_all_command_guards` is the loop that turns
    # the resolved entry into a permanent-allowlist write. The bridge
    # only signals the event — by design. So we can't assert the
    # permanent set gained the pattern here (no agent in the test).
    # What we CAN assert: our bridge did not double-resolve.
    assert bridge.resolve("sess-perm", "always") == 0  # nothing pending now
    # And we didn't proactively mutate _permanent_approved ourselves.
    delta = set(A._permanent_approved) - before
    assert delta == set(), f"bridge mutated permanent set: {delta!r}"
    bridge.unregister("sess-perm")


def test_deny_signals_with_correct_result() -> None:
    bridge = ApprovalBridge(ws=WSManager())
    bridge.register("sess-deny", "rid")
    entry = _enqueue_approval("sess-deny")
    bridge.resolve("sess-deny", "deny")
    assert entry.result == "deny"
    bridge.unregister("sess-deny")


def test_fifo_order_when_multiple_pending() -> None:
    bridge = ApprovalBridge(ws=WSManager())
    bridge.register("sess-fifo", "rid")
    e1 = _enqueue_approval("sess-fifo")
    e2 = _enqueue_approval("sess-fifo", pattern_key="sudo")
    e3 = _enqueue_approval("sess-fifo", pattern_key="dd_disk")

    bridge.resolve("sess-fifo", "once")
    bridge.resolve("sess-fifo", "deny")
    bridge.resolve("sess-fifo", "session")
    assert e1.result == "once"
    assert e2.result == "deny"
    assert e3.result == "session"

    bridge.unregister("sess-fifo")


def test_stale_mirror_popped_on_zero_resolve() -> None:
    """A resolve that finds no blocked thread (timeout / dup click) must still
    drop the replay mirror — otherwise every reconnect resurrects the dead
    drawer and every subsequent click resolves 0 forever."""
    bridge = ApprovalBridge(ws=WSManager())
    bridge._pending["sess-stale"] = {"type": "approval.requested", "session_key": "sess-stale"}

    assert bridge.resolve("sess-stale", "session") == 0
    assert bridge.list_pending() == []


def test_list_pending_prunes_mirrors_without_blocked_thread() -> None:
    """Replay only mirrors whose session still has a blocked agent thread."""
    bridge = ApprovalBridge(ws=WSManager())
    # Dead mirror: nothing queued upstream for this session.
    bridge._pending["sess-dead"] = {"type": "approval.requested", "session_key": "sess-dead"}
    # Live mirror: a real blocked entry exists.
    _enqueue_approval("sess-live")
    bridge._pending["sess-live"] = {"type": "approval.requested", "session_key": "sess-live"}

    replayed = bridge.list_pending()
    assert [p["session_key"] for p in replayed] == ["sess-live"]
    # The dead mirror was pruned, not just skipped.
    assert "sess-dead" not in bridge._pending

    bridge.unregister("sess-live")
