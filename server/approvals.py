"""Approval bridge — adapts upstream tools.approval to the Station WS fan-out."""

from __future__ import annotations

import logging
import threading
from typing import Any

from server.lib.upstream_shim import shim
from server.ws import WSManager, get_ws_manager

logger = logging.getLogger(__name__)


APPROVAL_CHANNEL = "approval"
VALID_CHOICES = ("once", "session", "always", "deny")


class ApprovalBridge:
    def __init__(self, ws: WSManager | None = None) -> None:
        self._ws = ws or get_ws_manager()
        # Mirror in-flight requests so reconnecting clients can be replayed
        # any prompts that fired while offline — otherwise upstream blocks forever.
        self._pending: dict[str, dict] = {}
        self._pending_lock = threading.Lock()

    def register(self, session_key: str, run_id: str) -> None:
        register_gateway_notify = shim.approval.register_notify
        if register_gateway_notify is None:
            logger.error("[hms.approvals] upstream register_gateway_notify unavailable")
            return

        def _notify(approval_data: dict) -> None:
            # AIAgent worker thread; loop-gone case is silently dropped — upstream times out.
            payload = {
                "type": "approval.requested",
                "run_id": run_id,
                "session_key": session_key,
                "command": approval_data.get("command", ""),
                "description": approval_data.get("description", ""),
                "pattern_key": approval_data.get("pattern_key", ""),
                "pattern_keys": list(approval_data.get("pattern_keys") or []),
            }
            with self._pending_lock:
                self._pending[session_key] = payload
            # Single broadcast: useApprovalBridge subscribes to APPROVAL_CHANNEL alone;
            # mirroring onto run:<id> caused duplicate handler fires via store/ws.ts.
            self._ws.broadcast_threadsafe(APPROVAL_CHANNEL, payload)

        register_gateway_notify(session_key, _notify)

    def list_pending(self) -> list[dict]:
        """Snapshot of pending approval.requested payloads for replay to reconnecting clients."""
        with self._pending_lock:
            return list(self._pending.values())

    def unregister(self, session_key: str) -> None:
        with self._pending_lock:
            self._pending.pop(session_key, None)
        unregister_gateway_notify = shim.approval.unregister_notify
        if unregister_gateway_notify is None:
            return
        unregister_gateway_notify(session_key)

    @staticmethod
    def bind_session_key(session_key: str) -> Any:
        """Bind contextvar; pair with unbind_session_key in a finally clause."""
        set_current_session_key = shim.approval.set_session_key
        if set_current_session_key is None:
            return None
        return set_current_session_key(session_key or "")

    @staticmethod
    def unbind_session_key(token: Any) -> None:
        reset_current_session_key = shim.approval.reset_session_key
        if reset_current_session_key is None or token is None:
            return

        try:
            reset_current_session_key(token)
        except Exception:
            # Token from a different context — non-fatal in shutdown paths.
            logger.debug("[hms.approvals] reset_current_session_key failed", exc_info=True)

    def resolve(self, session_key: str, choice: str) -> int:
        """Resolve oldest pending approval.

        Returns count resolved (0 = race after timeout / dup click).
        """
        if choice not in VALID_CHOICES:
            raise ValueError(
                f"invalid choice {choice!r}, expected one of {VALID_CHOICES}"
            )
        resolve_gateway_approval = shim.approval.resolve
        if resolve_gateway_approval is None:
            raise RuntimeError("upstream tools.approval.resolve_gateway_approval unavailable")
        resolved = resolve_gateway_approval(session_key, choice)
        if resolved:
            with self._pending_lock:
                self._pending.pop(session_key, None)
        return resolved


_default: ApprovalBridge | None = None


def get_bridge() -> ApprovalBridge:
    global _default
    if _default is None:
        _default = ApprovalBridge()
    return _default


def reset_for_test() -> None:
    global _default
    _default = None
