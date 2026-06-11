"""StationAdapter.send — gateway platform messages → platform.notice WS frames."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_send_broadcasts_platform_notice(quiet_hms_env) -> None:
    from server.adapter import StationAdapter

    adapter = StationAdapter.__new__(StationAdapter)  # skip __init__ (binds host/port)
    ws = MagicMock()
    ws.broadcast = AsyncMock()
    with patch("server.ws.get_ws_manager", return_value=ws):
        result = await adapter.send("sess-1", "⏳ Working — 9 min", metadata={"k": "v"})

    assert result.success is True
    channel, frame = ws.broadcast.await_args.args
    assert channel == "session:sess-1"
    assert frame["type"] == "platform.notice"
    assert frame["session_id"] == "sess-1"
    assert frame["content"] == "⏳ Working — 9 min"
    assert frame["metadata"] == {"k": "v"}
    assert frame["timestamp"] > 0


@pytest.mark.asyncio
async def test_send_failure_reports_undeliverable(quiet_hms_env) -> None:
    from server.adapter import StationAdapter

    adapter = StationAdapter.__new__(StationAdapter)
    ws = MagicMock()
    ws.broadcast = AsyncMock(side_effect=RuntimeError("loop closed"))
    with patch("server.ws.get_ws_manager", return_value=ws):
        result = await adapter.send("sess-1", "hello")

    assert result.success is False
    assert "loop closed" in (result.error or "")
