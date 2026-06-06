"""Sessions/messages routes — smoke against an isolated state.db."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest


@pytest.fixture
def upstream_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    pytest.importorskip("hermes_state", reason="hermes-agent venv required")
    from hermes_state import SessionDB
    from server.lib import state_db as st

    # Clear both the default singleton and any per-home SessionDB cache left by
    # earlier tests so this fixture owns the only visible DB handle.
    st.close_for_test()
    db = SessionDB(db_path=tmp_path / "state.db")
    st._singleton = db
    yield db
    st.close_for_test()


@pytest.fixture
async def sessions_client(upstream_db: Any, monkeypatch: pytest.MonkeyPatch):
    pytest.importorskip("aiohttp")
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
    from server.routes import chat

    # These route-smokes exercise one isolated tmp state.db, not the user's real
    # profile fan-out; pin the listing to the default home so /api/sessions
    # can't aggregate named-profile DBs from the live environment.
    monkeypatch.setattr(chat, "_profile_homes", lambda: [("default", None)])

    app = web.Application()
    chat.attach(app)
    server = TestServer(app)
    client = TestClient(server)
    await client.start_server()
    try:
        yield client
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_list_empty(sessions_client: Any) -> None:
    r = await sessions_client.get("/api/sessions")
    assert r.status == 200
    assert (await r.json()) == {"sessions": []}


@pytest.mark.asyncio
async def test_create_then_list_then_messages(
    sessions_client: Any, upstream_db: Any
) -> None:
    # Use upstream's own API to put a row in.
    upstream_db.create_session("sess_abc123", "station", model="test-model")
    upstream_db.append_message(
        session_id="sess_abc123",
        role="user",
        content="hello",
    )
    upstream_db.append_message(
        session_id="sess_abc123",
        role="assistant",
        content="hi there",
    )

    # List.
    r = await sessions_client.get("/api/sessions")
    body = await r.json()
    assert any(s["id"] == "sess_abc123" for s in body["sessions"])

    # Messages.
    r = await sessions_client.get("/api/sessions/sess_abc123/messages")
    assert r.status == 200
    msgs = (await r.json())["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert [m["content"] for m in msgs] == ["hello", "hi there"]


@pytest.mark.asyncio
async def test_rename_then_delete(sessions_client: Any, upstream_db: Any) -> None:
    upstream_db.create_session("sess_rename", "station")
    upstream_db.append_message(
        session_id="sess_rename", role="user", content="x"
    )

    # Rename.
    r = await sessions_client.patch(
        "/api/sessions/sess_rename", json={"title": "My Session"}
    )
    assert r.status == 200

    # Verify via list_sessions_rich.
    r = await sessions_client.get("/api/sessions")
    rec = next(s for s in (await r.json())["sessions"] if s["id"] == "sess_rename")
    assert rec["title"] == "My Session"

    # Delete.
    r = await sessions_client.delete("/api/sessions/sess_rename")
    assert r.status == 200

    # 404 on second delete.
    r = await sessions_client.delete("/api/sessions/sess_rename")
    assert r.status == 404


@pytest.mark.asyncio
async def test_rejects_invalid_session_id(sessions_client: Any) -> None:
    r = await sessions_client.get("/api/sessions/../etc/passwd/messages")
    # Path-traversal-ish input should never reach the DB.
    assert r.status in (400, 404)


@pytest.mark.asyncio
async def test_search(sessions_client: Any, upstream_db: Any) -> None:
    upstream_db.create_session("sess_search", "station")
    upstream_db.append_message(
        session_id="sess_search",
        role="user",
        content="please install postgres",
    )
    upstream_db.append_message(
        session_id="sess_search",
        role="assistant",
        content="here's how to install postgres on macos",
    )

    r = await sessions_client.get("/api/search?q=postgres")
    assert r.status == 200
    hits = (await r.json())["results"]
    assert len(hits) >= 1
    # FTS may surface the match via a snippet/content_match field rather
    # than the raw `content` column. Either way, "postgres" must appear
    # somewhere in the JSON-encoded hit.
    import json as _json
    assert any("postgres" in _json.dumps(h).lower() for h in hits)
