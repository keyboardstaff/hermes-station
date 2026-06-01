"""SessionStore unit tests — file format, TTL eviction, perms."""

from __future__ import annotations

import asyncio
import os
import stat
from pathlib import Path

import pytest
from server.lib.session_store import SessionStore


def _new_store(tmp_path: Path) -> SessionStore:
    return SessionStore(path=tmp_path / "sessions.json")


@pytest.mark.asyncio
async def test_create_then_validate(tmp_path: Path) -> None:
    store = _new_store(tmp_path)
    token = await store.create(ttl_seconds=60)
    assert token
    assert await store.is_valid(token)


@pytest.mark.asyncio
async def test_invalidate(tmp_path: Path) -> None:
    store = _new_store(tmp_path)
    token = await store.create(ttl_seconds=60)
    await store.invalidate(token)
    assert not await store.is_valid(token)


@pytest.mark.asyncio
async def test_expired_token_is_rejected(tmp_path: Path) -> None:
    store = _new_store(tmp_path)
    token = await store.create(ttl_seconds=0)
    # Force a clock advance via short sleep — 0-TTL means expires_at == now.
    await asyncio.sleep(0.05)
    assert not await store.is_valid(token)


@pytest.mark.asyncio
async def test_file_is_chmod_0600(tmp_path: Path) -> None:
    store = _new_store(tmp_path)
    await store.create(ttl_seconds=60)
    path = tmp_path / "sessions.json"
    assert path.is_file()
    # On Unix the user-only bits should be set; group/other should be off.
    mode = stat.S_IMODE(os.stat(path).st_mode)
    assert mode == 0o600


@pytest.mark.asyncio
async def test_concurrent_create_does_not_lose_writes(tmp_path: Path) -> None:
    store = _new_store(tmp_path)
    tokens = await asyncio.gather(*[store.create(ttl_seconds=60) for _ in range(20)])
    assert len(set(tokens)) == 20
    for tok in tokens:
        assert await store.is_valid(tok)
