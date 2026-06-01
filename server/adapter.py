"""StationAdapter — hermes-agent platform adapter backed by an aiohttp server."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from gateway.config import Platform  # hms-allow-hardcoding
from gateway.platforms.base import BasePlatformAdapter, SendResult  # hms-allow-hardcoding

if TYPE_CHECKING:
    from aiohttp import web

logger = logging.getLogger(__name__)


class StationAdapter(BasePlatformAdapter):
    def __init__(self, config: Any):
        super().__init__(config, Platform("station"))

        from server.lib.config_reader import hms_host, hms_port
        self._host: str = hms_host()
        self._port: int = hms_port()

        self._app: web.Application | None = None
        self._runner: web.AppRunner | None = None
        self._site: web.TCPSite | None = None

    async def connect(self) -> bool:
        from aiohttp import web

        from server.app import build_app

        try:
            self._app = build_app(adapter=self)
            # Bind locals first so type-narrowing holds across the awaits
            # (the `… | None` instance attrs don't narrow on their own).
            runner = web.AppRunner(self._app)
            await runner.setup()
            self._runner = runner
            site = web.TCPSite(runner, self._host, self._port)
            await site.start()
            self._site = site
        except Exception as exc:
            logger.error("[hms.station] Failed to start web server: %s", exc, exc_info=True)
            return False

        try:
            self._mark_connected()
        except Exception:
            # Older BasePlatformAdapter releases lack this hook.
            logger.debug("[hms.station] _mark_connected unavailable", exc_info=True)

        logger.info("[hms.station] Listening on http://%s:%d", self._host, self._port)
        return True

    async def disconnect(self) -> None:
        try:
            self._mark_disconnected()
        except Exception:
            logger.debug("[hms.station] _mark_disconnected unavailable", exc_info=True)
        if self._site is not None:
            await self._site.stop()
            self._site = None
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None
        self._app = None
        logger.info("[hms.station] Web server stopped")

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: str | None = None,
        metadata: dict | None = None,
    ) -> Any:
        return SendResult(
            success=False,
            error="Station delivers via REST/WebSocket; send() is unused",
        )

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        return {
            "name": "Station",
            "type": "web",
            "host": self._host,
            "port": self._port,
        }
