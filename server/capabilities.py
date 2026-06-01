"""Capability probe — drives the SPA's connectivity indicators."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TypedDict

from server.lib import config_reader
from server.lib.upstream_paths import hermes_home
from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)


class CapabilityResult(TypedDict):
    fsReadable: bool
    agentReady: bool
    dashboardReachable: bool
    gatewayReachable: bool
    mode: str
    reasons: list[str]
    probedAt: float


_cached: CapabilityResult | None = None


def get_cached() -> CapabilityResult | None:
    return _cached


async def _probe_fs() -> bool:
    path = hermes_home() / "config.yaml"
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, path.is_file)
    except Exception:
        return False


async def _probe_http(url: str, timeout_s: float = 3.0) -> bool:
    try:
        import aiohttp
        timeout = aiohttp.ClientTimeout(total=timeout_s)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                return resp.status < 400
    except Exception:
        return False


async def _probe_dashboard() -> bool:
    return await _probe_http(config_reader.dashboard_url() + "/api/status")


async def probe() -> CapabilityResult:
    # Gateway in this architecture has no standalone HTTP endpoint: the
    # hermes-agent host process loads Station as an in-process platform
    # plugin, so the same Python process that imports AIAgent is what
    # binds aiohttp on HMS_PORT. agent_importable is therefore the
    # authoritative gateway-alive signal.
    global _cached
    fs, dash = await asyncio.gather(_probe_fs(), _probe_dashboard())
    agent = shim.probe().agent_importable

    reasons: list[str] = []
    if not fs:
        reasons.append(f"{hermes_home()/'config.yaml'} not readable")
    if not agent:
        reasons.append("AIAgent could not be imported from the host venv")
    if not dash:
        reasons.append(f"Dashboard ({config_reader.dashboard_url()}) unreachable")

    mode = "ready" if (fs and agent) else "degraded"
    _cached = CapabilityResult(
        fsReadable=fs,
        agentReady=agent,
        dashboardReachable=dash,
        gatewayReachable=agent,
        mode=mode,
        reasons=reasons,
        probedAt=time.time(),
    )
    return _cached


DEFAULT_REFRESH_INTERVAL_S = 30.0


async def refresh_loop(interval_s: float = DEFAULT_REFRESH_INTERVAL_S) -> None:
    """Re-probe every interval_s.

    Swallow per-iteration errors so a transient failure never kills the loop.
    """
    logger.info("[hms.capabilities] refresh loop started (every %.0fs)", interval_s)
    try:
        await probe()
        while True:
            await asyncio.sleep(interval_s)
            try:
                await probe()
            except Exception:
                logger.exception("[hms.capabilities] probe iteration failed")
    except asyncio.CancelledError:
        logger.info("[hms.capabilities] refresh loop cancelled")
        raise
