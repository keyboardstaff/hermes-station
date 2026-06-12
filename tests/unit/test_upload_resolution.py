"""Upload-URL resolution for run input: text-mime files inline as code blocks;
binaries become their absolute on-disk path (the in-process agent can't fetch
Station's HTTP routes, but its tools take local paths)."""

from __future__ import annotations

from pathlib import Path

import pytest
from server.routes import runs as runs_routes
from server.routes import upload as upload_mod


@pytest.fixture()
def uploads(tmp_path, monkeypatch) -> Path:
    root = tmp_path / "uploads"
    root.mkdir()
    monkeypatch.setattr(upload_mod, "uploads_root", lambda: root)
    monkeypatch.setattr(runs_routes, "uploads_root", lambda: root)
    return root


def _put(root: Path, upload_id: str, name: str, data: bytes) -> Path:
    d = root / upload_id
    d.mkdir(parents=True, exist_ok=True)
    f = d / name
    f.write_bytes(data)
    return f


def test_text_mime_inlines_as_code_block(uploads: Path) -> None:
    _put(uploads, "u1", "notes.txt", b"hello world")
    out = runs_routes._resolve_upload_urls_in_text(
        "Attached file notes.txt: /api/upload/u1/notes.txt", uploads,
    )
    assert "```notes.txt\nhello world```" in out
    assert "/api/upload/" not in out


def test_binary_becomes_absolute_local_path(uploads: Path) -> None:
    f = _put(uploads, "u2", "demo.pdf", b"%PDF-1.4 fake")
    out = runs_routes._resolve_upload_urls_in_text(
        "Attached file demo.pdf: /api/upload/u2/demo.pdf", uploads,
    )
    assert str(f) in out
    assert "application/pdf" in out
    assert "/api/upload/" not in out


def test_media_binary_gets_path_too(uploads: Path) -> None:
    f = _put(uploads, "u3", "clip.mp4", b"\x00\x00fake")
    out = runs_routes._resolve_upload_urls_in_text(
        "see /api/upload/u3/clip.mp4 please", uploads,
    )
    assert str(f) in out


def test_missing_file_left_untouched(uploads: Path) -> None:
    text = "Attached file gone.bin: /api/upload/nope/gone.bin"
    assert runs_routes._resolve_upload_urls_in_text(text, uploads) == text
