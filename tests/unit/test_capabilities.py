"""Tests for the capability probe & refresh loop."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from server import capabilities
from server.lib import config_reader
from server.lib.upstream_shim import CapabilityFlags


def _agent_flags(importable: bool) -> CapabilityFlags:
    """Stand-in for ``shim.probe()`` — only the agent_importable bit is read by capabilities.probe()."""
    return CapabilityFlags(agent_importable=importable)


@pytest.fixture(autouse=True)
def _reset_module_state(monkeypatch: pytest.MonkeyPatch) -> None:
    capabilities._cached = None
    for var in (
        "HERMES_DASHBOARD_URL",
        "HMS_DASHBOARD_AUTOSTART",
        "HMS_GATEWAY_AUTOSTART",
    ):
        monkeypatch.delenv(var, raising=False)
    config_reader.reload()
    monkeypatch.setattr(config_reader, "_cached_doc", lambda: {})
    monkeypatch.setattr(config_reader, "_cached_extra", lambda: {})


@pytest.mark.asyncio
async def test_probe_returns_all_capability_fields() -> None:
    """The frontend contract requires every field non-None."""
    with patch.object(capabilities, "_probe_fs", return_value=True), \
         patch.object(capabilities, "_probe_dashboard", return_value=True), \
         patch.object(capabilities.shim, "probe", return_value=_agent_flags(True)):
        result = await capabilities.probe()

    assert set(result.keys()) == {
        "fsReadable", "agentReady",
        "dashboardReachable", "gatewayReachable",
        "mode", "reasons", "probedAt",
    }
    assert result["fsReadable"] is True
    assert result["agentReady"] is True
    assert result["dashboardReachable"] is True
    # Gateway is the in-process AIAgent — alive iff agent_importable.
    assert result["gatewayReachable"] is True
    assert result["mode"] == "ready"
    assert result["reasons"] == []


@pytest.mark.asyncio
async def test_probe_mode_degraded_when_agent_missing() -> None:
    with patch.object(capabilities, "_probe_fs", return_value=True), \
         patch.object(capabilities, "_probe_dashboard", return_value=True), \
         patch.object(capabilities.shim, "probe", return_value=_agent_flags(False)):
        result = await capabilities.probe()
    assert result["mode"] == "degraded"
    assert result["gatewayReachable"] is False
    assert any("AIAgent" in r for r in result["reasons"])


@pytest.mark.asyncio
async def test_get_cached_returns_none_before_first_probe() -> None:
    assert capabilities.get_cached() is None


@pytest.mark.asyncio
async def test_get_cached_returns_last_probe_result() -> None:
    with patch.object(capabilities, "_probe_fs", return_value=True), \
         patch.object(capabilities, "_probe_dashboard", return_value=False), \
         patch.object(capabilities.shim, "probe", return_value=_agent_flags(True)):
        first = await capabilities.probe()
    assert capabilities.get_cached() == first


@pytest.mark.asyncio
async def test_refresh_loop_populates_cache_immediately() -> None:
    """First iteration should run before the first sleep."""
    call_count = [0]

    async def fake_probe() -> capabilities.CapabilityResult:
        call_count[0] += 1
        return capabilities.CapabilityResult(
            fsReadable=True, agentReady=True,
            dashboardReachable=True, gatewayReachable=True,
            mode="ready", reasons=[], probedAt=0.0,
        )

    with patch.object(capabilities, "probe", side_effect=fake_probe):
        task = asyncio.create_task(capabilities.refresh_loop(interval_s=3600))
        # Yield long enough for the initial probe() to fire but not the
        # next 3600 s sleep. asyncio.sleep(0) only yields once; we need
        # the executor task chain to settle.
        for _ in range(5):
            await asyncio.sleep(0)
        assert call_count[0] >= 1
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
async def test_refresh_loop_swallows_iteration_errors() -> None:
    """A single bad probe must not break the loop."""
    call_count = [0]

    async def flaky_probe() -> capabilities.CapabilityResult:
        call_count[0] += 1
        if call_count[0] == 1:
            return capabilities.CapabilityResult(
                fsReadable=True, agentReady=True,
                dashboardReachable=True, gatewayReachable=True,
                mode="ready", reasons=[], probedAt=0.0,
            )
        if call_count[0] == 2:
            raise RuntimeError("boom")
        return capabilities.CapabilityResult(
            fsReadable=True, agentReady=True,
            dashboardReachable=True, gatewayReachable=True,
            mode="ready", reasons=[], probedAt=0.0,
        )

    with patch.object(capabilities, "probe", side_effect=flaky_probe):
        # Tiny interval so the second + third iterations actually run.
        task = asyncio.create_task(capabilities.refresh_loop(interval_s=0.01))
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert call_count[0] >= 3, "loop should have survived the RuntimeError"


def test_dashboard_autostart_default_true() -> None:
    with patch.object(config_reader, "_cached_extra", return_value={}):
        assert config_reader.dashboard_autostart() is True


def test_dashboard_autostart_yaml_false_wins() -> None:
    with patch.object(
        config_reader, "_cached_extra",
        return_value={"dashboard": {"autostart": False}},
    ):
        assert config_reader.dashboard_autostart() is False


def test_dashboard_autostart_env_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HMS_DASHBOARD_AUTOSTART", "0")
    with patch.object(
        config_reader, "_cached_extra",
        return_value={"dashboard": {"autostart": True}},
    ):
        assert config_reader.dashboard_autostart() is False


def test_gateway_autostart_default_true() -> None:
    with patch.object(config_reader, "_cached_extra", return_value={}):
        assert config_reader.gateway_autostart() is True


def test_gateway_autostart_env_overrides_yaml(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HMS_GATEWAY_AUTOSTART", "false")
    with patch.object(
        config_reader, "_cached_extra",
        return_value={"gateway": {"autostart": True}},
    ):
        assert config_reader.gateway_autostart() is False
