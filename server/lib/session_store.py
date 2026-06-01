"""File-backed session token store with TTL — ~/.hermes/station/sessions.json, chmod 0600."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from server.lib.upstream_paths import hms_data_dir

if TYPE_CHECKING:
    from collections.abc import Mapping


@dataclass(frozen=True)
class SessionEntry:
    created_at: float
    expires_at: float

    def is_expired(self, now: float | None = None) -> bool:
        return self.expires_at <= (now if now is not None else time.time())


class SessionStore:
    def __init__(self, path: Path | None = None) -> None:
        self._path = path or (hms_data_dir() / "sessions.json")
        self._lock = asyncio.Lock()
        self._cache: dict[str, SessionEntry] | None = None

    async def create(self, ttl_seconds: int) -> str:
        async with self._lock:
            store = await self._load_async()
            token = secrets.token_urlsafe(32)
            now = time.time()
            store[token] = SessionEntry(created_at=now, expires_at=now + ttl_seconds)
            await self._persist_async(store)
            return token

    async def invalidate(self, token: str) -> None:
        if not token:
            return
        async with self._lock:
            store = await self._load_async()
            if token in store:
                del store[token]
                await self._persist_async(store)

    async def invalidate_all(self) -> int:
        """Used on password rotation — forces everyone back through /api/login."""
        async with self._lock:
            store = await self._load_async()
            n = len(store)
            if n:
                await self._persist_async({})
            return n

    async def is_valid(self, token: str) -> bool:
        if not token:
            return False
        async with self._lock:
            store = await self._load_async()
            entry = store.get(token)
            if entry is None:
                return False
            if entry.is_expired():
                del store[token]
                await self._persist_async(store)
                return False
            return True

    def _load_sync(self) -> dict[str, SessionEntry]:
        if self._cache is not None:
            return self._cache
        try:
            raw = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            self._cache = {}
            return self._cache
        try:
            parsed: Mapping = json.loads(raw)
        except json.JSONDecodeError:
            self._cache = {}
            return self._cache
        now = time.time()
        out: dict[str, SessionEntry] = {}
        for tok, info in parsed.items():
            if not isinstance(info, dict):
                continue
            try:
                entry = SessionEntry(
                    created_at=float(info["createdAt"]),
                    expires_at=float(info["expiresAt"]),
                )
            except (KeyError, TypeError, ValueError):
                continue
            if entry.expires_at > now:
                out[tok] = entry
        self._cache = out
        return out

    async def _load_async(self) -> dict[str, SessionEntry]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._load_sync)

    async def _persist_async(self, store: dict[str, SessionEntry]) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._persist_sync, store)

    def _persist_sync(self, store: dict[str, SessionEntry]) -> None:
        self._cache = dict(store)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self._path.with_suffix(self._path.suffix + f".tmp.{os.getpid()}")
        payload = {
            tok: {"createdAt": e.created_at, "expiresAt": e.expires_at}
            for tok, e in store.items()
        }
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(tmp, self._path)
        try:
            os.chmod(self._path, 0o600)
        except OSError:
            pass


_default_store: SessionStore | None = None


def get_default_store() -> SessionStore:
    global _default_store
    if _default_store is None:
        _default_store = SessionStore()
    return _default_store
