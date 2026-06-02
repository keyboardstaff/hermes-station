"""Chat feature tests — POST /api/runs, GET /api/runs/{id}, POST /api/runs/{id}/stop."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.runs import RunHandle, RunRegistry


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    """Boot station in-process with a minimal config.yaml."""
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


def _make_handle(
    run_id: str = "run_" + "a" * 32,
    session_id: str = "sess_test",
    status: str = "running",
) -> RunHandle:
    return RunHandle(
        run_id=run_id,
        session_id=session_id,
        status=status,
        created_at=1_700_000_000.0,
        started_at=1_700_000_001.0,
    )


def _make_registry(handle: RunHandle | None = None) -> MagicMock:
    reg = MagicMock(spec=RunRegistry)
    reg.get = AsyncMock(return_value=handle)
    reg.add = AsyncMock()
    reg.remove = AsyncMock()
    return reg


def _make_start_run_patch(handle: RunHandle):
    return patch(
        "server.routes.runs.runs.start_run",
        new_callable=AsyncMock,
        return_value=handle,
    )


@pytest.mark.asyncio
async def test_new_session_returns_run_and_session_id(app_server):
    """N1: POST /api/runs without session_id returns run_id + session_id (202)."""
    handle = _make_handle(run_id="run_" + "b" * 32, session_id="run_" + "b" * 32)
    with _make_start_run_patch(handle):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/runs",
                json={"input": "hello"},
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 202
                data = await r.json()

    assert data["run_id"] == handle.run_id
    assert data["session_id"] == handle.session_id
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_existing_session_passes_session_id(app_server):
    """N2: POST /api/runs with session_id passes it through to start_run."""
    sid = "existing-session-123"
    handle = _make_handle(session_id=sid)
    with (
        _make_start_run_patch(handle),
        patch("server.routes.runs.runs.start_run", new_callable=AsyncMock, return_value=handle) as mock_start,
    ):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/runs",
                json={"input": "follow up", "session_id": sid},
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 202

        mock_start.assert_called_once()
        call_kwargs = mock_start.call_args.kwargs
        assert call_kwargs["session_id"] == sid


@pytest.mark.asyncio
async def test_profile_passed_through_to_start_run(app_server):
    """POST /api/runs with a valid profile threads it to start_run."""
    handle = _make_handle()
    with patch(
        "server.routes.runs.runs.start_run", new_callable=AsyncMock, return_value=handle
    ) as mock_start:
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/runs",
                json={"input": "hi", "profile": "creative"},
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 202

        mock_start.assert_called_once()
        assert mock_start.call_args.kwargs["profile"] == "creative"


@pytest.mark.asyncio
async def test_invalid_profile_name_rejected(app_server):
    """A malformed profile name is a 400 before any run starts."""
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/runs",
            json={"input": "hi", "profile": "Bad Name!"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400
            assert (await r.json())["error"] == "invalid_profile"


@pytest.mark.asyncio
async def test_multimodal_input_extracts_text(app_server):
    """N3: OpenAI vision-style list input — text extracted from .text field, image_url skipped."""
    handle = _make_handle()
    with _make_start_run_patch(handle) as mock_start:
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/runs",
                json={
                    "input": [
                        {"type": "text", "text": "describe this image"},
                        {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
                    ]
                },
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 202

        call_kwargs = mock_start.call_args.kwargs
        # input_data is now the full list (not text-extracted), preserving image_url
        input_data = call_kwargs["input_data"]
        assert isinstance(input_data, list)
        text_part = next(p for p in input_data if p.get("type") == "text")
        assert text_part["text"] == "describe this image"
        image_part = next(p for p in input_data if p.get("type") == "image_url")
        assert "data:image/png" in image_part["image_url"]["url"]


@pytest.mark.asyncio
async def test_multimodal_input_legacy_content_field(app_server):
    """N3b: Legacy .content field (non-vision) is also accepted as text."""
    handle = _make_handle()
    with _make_start_run_patch(handle) as mock_start:
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/runs",
                json={"input": [{"type": "text", "content": "legacy field"}]},
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 202

        call_kwargs = mock_start.call_args.kwargs
        # input_data is the full list for multimodal; legacy .content field accepted
        input_data = call_kwargs["input_data"]
        assert isinstance(input_data, list)
        text_part = input_data[0]
        assert text_part.get("content") == "legacy field" or text_part.get("text") == "legacy field"


@pytest.mark.asyncio
async def test_stop_run_returns_ok(app_server):
    """N8: POST /api/runs/{id}/stop for a known run → 200 {ok: true}."""
    run_id = "run_" + "c" * 32
    with patch("server.routes.runs.runs.stop_run", new_callable=AsyncMock, return_value=True):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/runs/{run_id}/stop",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 200
                data = await r.json()
                assert data["ok"] is True


@pytest.mark.asyncio
async def test_get_running_run_returns_status(app_server):
    """N9a: GET /api/runs/{id} for a running run → 200 with status=running."""
    run_id = "run_" + "d" * 32
    handle = _make_handle(run_id=run_id, status="running")
    with patch("server.routes.runs.runs.get_registry") as mock_reg:
        mock_reg.return_value.get = AsyncMock(return_value=handle)
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/runs/{run_id}") as r:
                assert r.status == 200
                data = await r.json()

    assert data["status"] == "running"
    assert data["run_id"] == run_id


@pytest.mark.asyncio
async def test_get_completed_run_returns_completed(app_server):
    """N9b: GET /api/runs/{id} for completed run → status=completed."""
    run_id = "run_" + "e" * 32
    handle = _make_handle(run_id=run_id, status="completed")
    handle.output = "The answer is 42."
    with patch("server.routes.runs.runs.get_registry") as mock_reg:
        mock_reg.return_value.get = AsyncMock(return_value=handle)
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/runs/{run_id}") as r:
                assert r.status == 200
                data = await r.json()

    assert data["status"] == "completed"
    assert data["output"] == "The answer is 42."


@pytest.mark.asyncio
async def test_missing_input_key_returns_400(app_server):
    """E1/S3: POST /api/runs with no `input` key → 400 missing_input."""
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/runs",
            json={"model": "gpt-4"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "missing_input"


@pytest.mark.asyncio
async def test_empty_string_input_returns_400(app_server):
    """E1c/S2: POST /api/runs with whitespace-only input → 400 empty_input."""
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/runs",
            json={"input": "   "},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "empty_input"


@pytest.mark.asyncio
async def test_invalid_json_body_returns_400(app_server):
    """E1b: POST /api/runs with malformed JSON → 400 invalid_json."""
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/runs",
            data=b"not json{{{",
            headers={
                "Content-Type": "application/json",
                "X-HMS-CSRF": "1",
            },
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "invalid_json"


@pytest.mark.asyncio
async def test_get_run_bad_id_format_returns_400(app_server):
    """E6: GET /api/runs/{bad-id} — doesn't match run_HEXHEX32 pattern → 400."""
    async with aiohttp.ClientSession() as cs:
        async with cs.get(f"{app_server}/api/runs/not-a-valid-run-id") as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "invalid_run_id"


@pytest.mark.asyncio
async def test_stop_run_bad_id_format_returns_400(app_server):
    """E6 (stop): POST /api/runs/{bad-id}/stop → 400 invalid_run_id."""
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/runs/../../etc-passwd/stop",
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            # Path traversal attempt → normalised to a path that won't match route,
            # or rejected by run_id validator.
            assert r.status in (400, 404)


@pytest.mark.asyncio
async def test_optional_fields_passed_to_start_run(app_server):
    """B1: model/provider/reasoning_effort are accepted and forwarded."""
    handle = _make_handle()
    with patch("server.routes.runs.runs.start_run", new_callable=AsyncMock, return_value=handle) as mock_start:
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/runs",
                json={
                    "input": "summarise",
                    "model": "gpt-4o",
                    "provider": "openai",
                    "reasoning_effort": "high",
                },
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 202

        kw = mock_start.call_args.kwargs
        assert kw["model"] == "gpt-4o"
        assert kw["provider"] == "openai"
        assert kw["reasoning_effort"] == "high"


@pytest.mark.asyncio
async def test_get_unknown_run_returns_404(app_server):
    """B5: GET /api/runs/{id} for a valid-format but unknown run_id → 404."""
    run_id = "run_" + "f" * 32
    with patch("server.routes.runs.runs.get_registry") as mock_reg:
        mock_reg.return_value.get = AsyncMock(return_value=None)
        async with aiohttp.ClientSession() as cs:
            async with cs.get(f"{app_server}/api/runs/{run_id}") as r:
                assert r.status == 404
                data = await r.json()
                assert data["error"] == "not_found"


@pytest.mark.asyncio
async def test_stop_unknown_run_returns_404(app_server):
    """B6: POST /api/runs/{id}/stop for unknown run → 404 not_found."""
    run_id = "run_" + "0" * 32
    with patch("server.routes.runs.runs.stop_run", new_callable=AsyncMock, return_value=False):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/runs/{run_id}/stop",
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 404
                data = await r.json()
                assert data["error"] == "not_found"


@pytest.mark.asyncio
async def test_start_run_exception_returns_500(app_server):
    """E1 (backend): if start_run raises, route returns 500 internal_error."""
    with patch(
        "server.routes.runs.runs.start_run",
        new_callable=AsyncMock,
        side_effect=RuntimeError("upstream unavailable"),
    ):
        async with aiohttp.ClientSession() as cs:
            async with cs.post(
                f"{app_server}/api/runs",
                json={"input": "hello"},
                headers={"X-HMS-CSRF": "1"},
            ) as r:
                assert r.status == 500
                data = await r.json()
                assert data["error"] == "internal_error"


@pytest.mark.asyncio
async def test_invalid_session_id_in_body_returns_400(app_server):
    """session_id with illegal characters returns 400 invalid_session_id."""
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/runs",
            json={"input": "hello", "session_id": "bad id with spaces"},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "invalid_session_id"


@pytest.mark.asyncio
async def test_empty_multipart_list_input_returns_400(app_server):
    """S4: input is an empty list [] → 400 missing_input."""
    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/runs",
            json={"input": []},
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400
            data = await r.json()
            assert data["error"] == "missing_input"
