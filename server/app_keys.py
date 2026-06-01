"""Typed AppKey handles for shared state on web.Application."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from aiohttp.web import AppKey

if TYPE_CHECKING:
    from server.adapter import StationAdapter
    from server.lib.dashboard_supervisor import DashboardSupervisor


ADAPTER_KEY: AppKey[StationAdapter | None] = AppKey("adapter", Any)

CAPABILITY_TASK_KEY: AppKey[asyncio.Task[None]] = AppKey("capability_task", asyncio.Task)
DISCOVERY_TASK_KEY: AppKey[asyncio.Task[None]] = AppKey("discovery_task", asyncio.Task)
UPLOAD_GC_TASK_KEY: AppKey[asyncio.Task[None]] = AppKey("upload_gc_task", asyncio.Task)
DASHBOARD_WATCHDOG_TASK_KEY: AppKey[asyncio.Task[None]] = AppKey(
    "dashboard_watchdog_task", asyncio.Task,
)

DASHBOARD_SUPERVISOR_KEY: AppKey[DashboardSupervisor] = AppKey(
    "dashboard_supervisor", Any,
)


# Watchdog first so it doesn't observe supervisor termination and respawn.
ALL_TASK_KEYS: tuple[AppKey[asyncio.Task[None]], ...] = (
    DASHBOARD_WATCHDOG_TASK_KEY,
    CAPABILITY_TASK_KEY,
    DISCOVERY_TASK_KEY,
    UPLOAD_GC_TASK_KEY,
)


__all__ = [
    "ADAPTER_KEY",
    "CAPABILITY_TASK_KEY",
    "DISCOVERY_TASK_KEY",
    "UPLOAD_GC_TASK_KEY",
    "DASHBOARD_WATCHDOG_TASK_KEY",
    "DASHBOARD_SUPERVISOR_KEY",
    "ALL_TASK_KEYS",
]
