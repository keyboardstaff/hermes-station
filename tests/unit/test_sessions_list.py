"""GET /api/sessions reads every profile's state.db, merges + sorts, and tags
each row with its profile — so a non-default profile's chats aren't invisible.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest


@pytest.mark.asyncio
async def test_list_sessions_aggregates_and_tags_profiles(quiet_hms_env, monkeypatch) -> None:
    import server.routes.chat as chat
    from aiohttp.test_utils import make_mocked_request

    default_db = MagicMock()
    default_db.list_sessions_rich.return_value = [
        {"session_id": "s_default", "started_at": 100, "title": "d"},
    ]
    creative_db = MagicMock()
    creative_db.list_sessions_rich.return_value = [
        {"session_id": "s_creative", "started_at": 200, "title": "c"},
    ]
    monkeypatch.setattr(chat, "_profile_homes", lambda: [("default", None), ("creative", "/h/c")])
    monkeypatch.setattr(chat, "db", lambda: default_db)
    monkeypatch.setattr(chat, "db_for_home", lambda h: creative_db)

    resp = await chat.list_sessions(make_mocked_request("GET", "/api/sessions?limit=100"))
    data = json.loads(resp.body)
    # Merged + sorted by started_at desc; each row tagged with its profile.
    assert [s["session_id"] for s in data["sessions"]] == ["s_creative", "s_default"]
    by_id = {s["session_id"]: s for s in data["sessions"]}
    assert by_id["s_creative"]["profile"] == "creative"
    assert by_id["s_default"]["profile"] == "default"


@pytest.mark.asyncio
async def test_list_sessions_default_db_failure_is_500(quiet_hms_env, monkeypatch) -> None:
    import server.routes.chat as chat
    from aiohttp.test_utils import make_mocked_request

    boom = MagicMock()
    boom.list_sessions_rich.side_effect = RuntimeError("db down")
    monkeypatch.setattr(chat, "_profile_homes", lambda: [("default", None)])
    monkeypatch.setattr(chat, "db", lambda: boom)

    resp = await chat.list_sessions(make_mocked_request("GET", "/api/sessions"))
    assert resp.status == 500


@pytest.mark.asyncio
async def test_list_sessions_named_profile_failure_is_skipped(quiet_hms_env, monkeypatch) -> None:
    """A named profile's DB error is tolerated — default sessions still return."""
    import server.routes.chat as chat
    from aiohttp.test_utils import make_mocked_request

    default_db = MagicMock()
    default_db.list_sessions_rich.return_value = [{"session_id": "s1", "started_at": 1}]
    bad = MagicMock()
    bad.list_sessions_rich.side_effect = RuntimeError("creative db corrupt")
    monkeypatch.setattr(chat, "_profile_homes", lambda: [("default", None), ("creative", "/h/c")])
    monkeypatch.setattr(chat, "db", lambda: default_db)
    monkeypatch.setattr(chat, "db_for_home", lambda h: bad)

    resp = await chat.list_sessions(make_mocked_request("GET", "/api/sessions"))
    assert resp.status == 200
    assert [s["session_id"] for s in json.loads(resp.body)["sessions"]] == ["s1"]
