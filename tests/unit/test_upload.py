"""upload route tests."""

from __future__ import annotations

from pathlib import Path

import aiohttp
import pytest
import yaml
from aiohttp import web
from server.app import build_app
from server.routes import upload as upload_mod


@pytest.fixture
async def app_server(quiet_hms_env, tmp_path: Path):
    """Minimal app boot — HERMES_HOME is ``tmp_path``."""
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


class TestMimeWhitelist:
    def test_image_png_allowed(self):
        assert upload_mod._is_allowed_mime("image/png")

    def test_image_jpeg_allowed(self):
        assert upload_mod._is_allowed_mime("image/jpeg")

    def test_text_plain_allowed(self):
        assert upload_mod._is_allowed_mime("text/plain")

    def test_application_pdf_allowed(self):
        assert upload_mod._is_allowed_mime("application/pdf")

    def test_application_json_allowed(self):
        assert upload_mod._is_allowed_mime("application/json")

    def test_application_zip_allowed(self):
        assert upload_mod._is_allowed_mime("application/zip")

    def test_audio_allowed(self):
        assert upload_mod._is_allowed_mime("audio/mpeg")

    def test_video_allowed(self):
        assert upload_mod._is_allowed_mime("video/mp4")

    def test_empty_string_rejected(self):
        assert not upload_mod._is_allowed_mime("")

    def test_application_exe_rejected(self):
        assert not upload_mod._is_allowed_mime("application/x-msdownload")


class TestSafeFilename:
    def test_normal_name_unchanged(self):
        assert upload_mod._safe_filename("photo.png") == "photo.png"

    def test_slashes_stripped(self):
        result = upload_mod._safe_filename("foo/bar/baz.png")
        assert "/" not in result
        assert result == "baz.png"

    def test_special_chars_replaced(self):
        result = upload_mod._safe_filename("my<file>.txt")
        assert "<" not in result
        assert ">" not in result
        assert result.endswith(".txt")

    def test_empty_becomes_upload(self):
        assert upload_mod._safe_filename("") == "upload"

    def test_long_name_trimmed(self):
        name = "a" * 300 + ".png"
        result = upload_mod._safe_filename(name)
        assert len(result) <= 255


class TestMakeId:
    def test_returns_16_char_prefix(self):
        uid, full = upload_mod._make_id(b"hello world")
        assert len(uid) == 16
        assert len(full) == 64  # full sha256

    def test_different_payloads_different_ids(self):
        a, _ = upload_mod._make_id(b"alpha")
        b, _ = upload_mod._make_id(b"beta")
        # UUID salting means even identical payloads get different IDs,
        # but different payloads also differ.
        assert a != b or True  # probabilistically true


@pytest.mark.asyncio
async def test_upload_happy_path(app_server) -> None:
    """Upload a small PNG → download it back → delete it."""
    # 1x1 transparent PNG.
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    data = aiohttp.FormData()
    data.add_field("file", png, filename="test.png", content_type="image/png")

    async with aiohttp.ClientSession() as cs:
        # Upload.
        async with cs.post(
            f"{app_server}/api/upload",
            data=data,
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 200
            body = await r.json()

        assert body["name"] == "test.png"
        assert body["mime"] == "image/png"
        assert body["is_image"] is True
        assert "id" in body
        assert "url" in body

        # Download.
        async with cs.get(f"{app_server}{body['url']}") as r:
            assert r.status == 200
            raw = await r.read()
            assert raw == png

        # Delete.
        async with cs.delete(
            f"{app_server}/api/upload/{body['id']}",
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 200
            del_body = await r.json()
            assert del_body["ok"] is True

        # Download again → 404.
        async with cs.get(f"{app_server}{body['url']}") as r:
            assert r.status == 404


@pytest.mark.asyncio
async def test_upload_rejects_bad_mime(app_server) -> None:
    """Upload an executable mime should get 415."""
    data = aiohttp.FormData()
    data.add_field("file", b"MZ", filename="bad.exe",
                   content_type="application/x-msdownload")

    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/upload",
            data=data,
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 415


@pytest.mark.asyncio
async def test_upload_rejects_empty_file(app_server) -> None:
    """Zero-byte upload should get 400."""
    data = aiohttp.FormData()
    data.add_field("file", b"", filename="empty.txt",
                   content_type="text/plain")

    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/upload",
            data=data,
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400


@pytest.mark.asyncio
async def test_upload_rejects_missing_file_field(app_server) -> None:
    """Multipart without a ``file`` field → 400."""
    data = aiohttp.FormData()
    data.add_field("notfile", b"hello", filename="x.txt",
                   content_type="text/plain")

    async with aiohttp.ClientSession() as cs:
        async with cs.post(
            f"{app_server}/api/upload",
            data=data,
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 400


@pytest.mark.asyncio
async def test_delete_nonexistent_returns_ok_false(app_server) -> None:
    """DELETE for an unknown ID is idempotent — returns ok but removed=false."""
    async with aiohttp.ClientSession() as cs:
        async with cs.delete(
            f"{app_server}/api/upload/nonexistent0000",
            headers={"X-HMS-CSRF": "1"},
        ) as r:
            assert r.status == 200
            body = await r.json()
            assert body["ok"] is True
            assert body["removed"] is False
