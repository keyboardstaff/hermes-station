"""``server/routes/messages.py`` — session transcript + FTS search."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    """Boot station. The messages route is wired by default in."""
    (tmp_path / "config.yaml").write_text(
        yaml.safe_dump({"platforms": {"station": {"extra": {
            "host": "127.0.0.1",
            "port": 3131,
        }}}}),
        encoding="utf-8",
    )
    from server.lib import config_reader
    config_reader.reload()

    app = build_app(adapter=None)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host="127.0.0.1", port=0)
    await site.start()
    host, port = runner.addresses[0][:2]
    base = f"http://{host}:{port}"
    try:
        yield base
    finally:
        await runner.cleanup()
        config_reader.reload()


def _install_db(get_messages_return=None, search_return=None, *, raise_on=None):
    fake_db = MagicMock()
    if raise_on == "get_messages":
        fake_db.get_messages.side_effect = RuntimeError("db kaboom")
    else:
        fake_db.get_messages.return_value = get_messages_return or []
    if raise_on == "search_messages":
        fake_db.search_messages.side_effect = RuntimeError("fts kaboom")
    else:
        fake_db.search_messages.return_value = search_return or []
    return patch("server.routes.chat.db", return_value=fake_db), fake_db


@pytest.mark.asyncio
async def test_get_messages_happy_path(app_server):
    rows = [
        {"id": 1, "role": "user", "content": "hello", "created_at": 1.0},
        {"id": 2, "role": "assistant", "content": "hi", "created_at": 2.0,
         "tool_calls": [{"id": "tc1", "name": "bash"}]},
    ]
    patcher, fake_db = _install_db(get_messages_return=rows)
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/sessions/abc123/messages") as r:
                assert r.status == 200
                data = await r.json()

    assert data == {"messages": rows, "total": len(rows), "offset": 0}
    # And the DB was called with the session id verbatim.
    fake_db.get_messages.assert_called_once_with("abc123")


@pytest.mark.asyncio
async def test_get_messages_invalid_session_id(app_server):
    """Disallowed characters → 400 without ever touching the DB."""
    patcher, fake_db = _install_db()
    with patcher:
        async with aiohttp.ClientSession() as cs:
            # Slashes are not in the [\w\-:.]{1,128} allowlist; using `..` to
            # check the literal value as the path-encoded id.
            async with cs.get(f"{app_server}/api/sessions/bad%20id%20with%20spaces/messages") as r:
                assert r.status == 400
                data = await r.json()
                assert data["error"] == "invalid_session_id"

    fake_db.get_messages.assert_not_called()


@pytest.mark.asyncio
async def test_get_messages_session_id_too_long(app_server):
    """129-char session id → 400."""
    long_id = "a" * 129
    patcher, _ = _install_db()
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/sessions/{long_id}/messages") as r:
                assert r.status == 400


@pytest.mark.asyncio
async def test_get_messages_db_error_surfaces_500(app_server):
    patcher, _ = _install_db(raise_on="get_messages")
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/sessions/abc/messages") as r:
                assert r.status == 500
                data = await r.json()
                assert data["error"] == "db_error"
                assert "db kaboom" in data["detail"]


@pytest.mark.asyncio
async def test_search_returns_hits(app_server):
    hits = [
        {"session_id": "s1", "message_id": 7, "snippet": "…matched…", "score": 0.91},
    ]
    patcher, fake_db = _install_db(search_return=hits)
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/search?q=needle") as r:
                assert r.status == 200
                data = await r.json()

    assert data == {"results": hits}
    fake_db.search_messages.assert_called_once()
    call_kwargs = fake_db.search_messages.call_args.kwargs
    assert call_kwargs["limit"] == 20
    assert call_kwargs["offset"] == 0
    assert call_kwargs["source_filter"] is None
    assert call_kwargs["role_filter"] is None
    # First positional arg is the query.
    assert fake_db.search_messages.call_args.args[0] == "needle"


@pytest.mark.asyncio
async def test_search_empty_q_short_circuits(app_server):
    """No query string → empty results, no DB call."""
    patcher, fake_db = _install_db(search_return=[{"x": 1}])
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/search?q=") as r:
                assert r.status == 200
                data = await r.json()

    assert data == {"results": []}
    fake_db.search_messages.assert_not_called()


@pytest.mark.asyncio
async def test_search_applies_filters_and_pagination(app_server):
    patcher, fake_db = _install_db(search_return=[])
    with patcher:
        async with aiohttp.ClientSession() as cs:
            url = (
                f"{app_server}/api/search?"
                "q=foo&source=station&role=assistant&limit=50&offset=100"
            )
            async with cs.get(url) as r:
                assert r.status == 200

    kw = fake_db.search_messages.call_args.kwargs
    assert kw["limit"] == 50
    assert kw["offset"] == 100
    assert kw["source_filter"] == ["station"]
    assert kw["role_filter"] == ["assistant"]


@pytest.mark.asyncio
async def test_search_clamps_out_of_range_limit(app_server):
    """limit=999999 → clamp to 100; limit=garbage → fall back to 20."""
    patcher, fake_db = _install_db(search_return=[])
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/search?q=x&limit=999999") as r:
                assert r.status == 200
            assert fake_db.search_messages.call_args.kwargs["limit"] == 100

            async with cs.get(f"{app_server}/api/search?q=x&limit=notanint") as r:
                assert r.status == 200
            assert fake_db.search_messages.call_args.kwargs["limit"] == 20


@pytest.mark.asyncio
async def test_search_db_error_surfaces_500(app_server):
    patcher, _ = _install_db(raise_on="search_messages")
    with patcher:
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/search?q=x") as r:
                assert r.status == 500
                data = await r.json()
                assert data["error"] == "db_error"
                assert "fts kaboom" in data["detail"]


# ── Clear session transcript (real wipe via SessionDB.clear_messages) ──


@pytest.mark.asyncio
async def test_clear_messages_happy_path(app_server):
    fake_db = MagicMock()
    with patch("server.routes.chat.db", return_value=fake_db):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/sessions/abc123/clear",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 200, await r.text()
                assert await r.json() == {"ok": True}
    fake_db.clear_messages.assert_called_once_with("abc123")


@pytest.mark.asyncio
async def test_clear_messages_invalid_session_id(app_server):
    fake_db = MagicMock()
    with patch("server.routes.chat.db", return_value=fake_db):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/sessions/bad%20id/clear",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 400
    fake_db.clear_messages.assert_not_called()


@pytest.mark.asyncio
async def test_clear_messages_requires_csrf(app_server):
    fake_db = MagicMock()
    with patch("server.routes.chat.db", return_value=fake_db):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(f"{app_server}/api/sessions/abc/clear") as r:
                assert r.status == 403
    fake_db.clear_messages.assert_not_called()


@pytest.mark.asyncio
async def test_clear_messages_unsupported_503(app_server):
    # A db handle without clear_messages (older upstream) ⇒ graceful 503.
    fake_db = MagicMock(spec=["get_messages", "search_messages"])
    with patch("server.routes.chat.db", return_value=fake_db):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/sessions/abc/clear",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 503
