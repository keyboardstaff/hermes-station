"""File upload + retrieval — MIME-whitelisted, streamed, retention-swept."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
import uuid
from pathlib import Path

from aiohttp import BodyPartReader, web

from server.lib import config_reader
from server.lib.route_helpers import SESSION_ID_RE
from server.lib.upstream_paths import hms_data_dir

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

_ALLOWED_PREFIXES = ("image/", "audio/", "video/", "text/")
_ALLOWED_EXACT = {
    "application/pdf",
    "application/json",
    "application/xml",
    "application/zip",
    "application/epub+zip",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/octet-stream",
}

_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._\- ]{1,255}$")

_GC_INTERVAL_S = 24 * 3600


def uploads_root() -> Path:
    d = hms_data_dir() / "uploads"
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    return d


def _is_allowed_mime(mime: str, filename: str | None = None) -> bool:
    """Falls back to extension for formats with unstable MIMEs (e.g. EPUB)."""
    if not mime:
        return False
    if mime in _ALLOWED_EXACT:
        return True
    if any(mime.startswith(p) for p in _ALLOWED_PREFIXES):
        return True
    if filename:
        basename = Path(filename).suffix.lower()
        if basename == ".epub":
            return True
    return False


def _safe_filename(raw: str) -> str:
    """Sanitise client-supplied filenames.

    Safari has shipped clipboard images with embedded slashes.
    """
    name = Path(raw).name or "upload"
    safe = re.sub(r"[^A-Za-z0-9._\- ]", "_", name)
    if len(safe) > 255:
        stem = Path(safe).stem[:240]
        ext = Path(safe).suffix[:14]
        safe = f"{stem}{ext}"
    return safe or "upload"


def _make_id_streaming(hasher: hashlib._Hash) -> tuple[str, str]:
    full = hasher.hexdigest()
    return full[:16], full


def _make_id(payload: bytes) -> tuple[str, str]:
    """16-char prefix gives ~10^19 IDs while keeping URLs readable; full sha256 in sidecar."""
    salt = uuid.uuid4().bytes
    h = hashlib.sha256()
    h.update(salt)
    h.update(payload)
    return _make_id_streaming(h)


def _entry_dir(upload_id: str) -> Path:
    return uploads_root() / upload_id


def _meta_path(upload_id: str, filename: str) -> Path:
    return _entry_dir(upload_id) / f"{filename}.meta.json"


@router.post("/api/upload")
async def handle_upload(request: web.Request) -> web.Response:
    try:
        reader = await request.multipart()
    except Exception:
        return web.json_response({"error": "multipart_parse_failed"}, status=400)

    file_part = None
    session_id: str | None = None
    # Text fields must arrive BEFORE the file part (api.ts enforces this).
    while True:
        part = await reader.next()
        if part is None:
            break
        # reader.next() yields BodyPartReader | MultipartReader; Station only
        # sends flat parts, so skip (and narrow away) any nested multipart group.
        if not isinstance(part, BodyPartReader):
            continue
        part_name = getattr(part, "name", None)
        if part_name == "session_id":
            raw_sid = await part.read(decode=True)
            sid = raw_sid.decode("utf-8", errors="replace").strip()
            if sid and SESSION_ID_RE.match(sid):
                session_id = sid
        elif part_name == "file":
            file_part = part
            # File part is last; break so we can stream it without re-calling next().
            break

    if file_part is None:
        return web.json_response({"error": "missing_file_field"}, status=400)

    raw_ct = file_part.headers.get("Content-Type") or "application/octet-stream"
    mime = raw_ct.split(";")[0].strip()
    file_name = file_part.filename or "upload"
    if not _is_allowed_mime(mime, file_name):
        return web.json_response({"error": "mime_not_allowed", "mime": mime}, status=415)

    name = _safe_filename(file_part.filename or "upload")

    # Stream to a temp file with incremental hash — keeps peak memory at ~64 KiB.
    salt = uuid.uuid4().bytes
    hasher = hashlib.sha256()
    hasher.update(salt)

    max_bytes = config_reader.max_upload_bytes()
    tmp_path = uploads_root() / f"{uuid.uuid4().hex}.upload.tmp"
    total = 0
    try:
        with tmp_path.open("wb") as _tmp_f:
            while True:
                block = await file_part.read_chunk(64 * 1024)
                if not block:
                    break
                total += len(block)
                if total > max_bytes:
                    tmp_path.unlink(missing_ok=True)
                    return web.json_response(
                        {"error": "too_large", "limit": max_bytes}, status=413
                    )
                hasher.update(block)
                _tmp_f.write(block)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise

    if total == 0:
        tmp_path.unlink(missing_ok=True)
        return web.json_response({"error": "empty_file"}, status=400)

    upload_id, sha = _make_id_streaming(hasher)
    entry = _entry_dir(upload_id)
    entry.mkdir(parents=True, exist_ok=True, mode=0o700)
    dest = entry / name
    tmp_path.replace(dest)

    meta: dict = {
        "id": upload_id,
        "name": name,
        "mime": mime,
        "size": total,
        "sha256": sha,
        "uploaded_at": time.time(),
        "is_image": mime.startswith("image/"),
        "is_audio": mime.startswith("audio/"),
        "is_video": mime.startswith("video/"),
    }
    if session_id:
        meta["session_id"] = session_id
    _meta_path(upload_id, name).write_text(
        json.dumps(meta, separators=(",", ":")),
        encoding="utf-8",
    )

    return web.json_response({
        **meta,
        # Embed name in URL — GET handler verifies it, so a leaked id alone can't traverse.
        "url": f"/api/upload/{upload_id}/{name}",
    })


# MUST come before /api/upload/{upload_id}/{name} — aiohttp matches in insertion order.
@router.get(r"/api/upload/session/{session_id}")
async def handle_session_attachments(request: web.Request) -> web.Response:
    """Ordered by uploaded_at so callers can map [screenshot] placeholders in transcript order."""
    session_id = request.match_info["session_id"]
    if not SESSION_ID_RE.match(session_id):
        return web.json_response({"error": "invalid_session_id"}, status=400)

    root = uploads_root()
    results: list[dict] = []
    try:
        for entry in root.iterdir():
            if not entry.is_dir():
                continue
            for meta_file in entry.glob("*.meta.json"):
                try:
                    meta = json.loads(meta_file.read_text("utf-8"))
                except Exception:  # noqa: S112 — skip unreadable/corrupt meta sidecar
                    continue
                if meta.get("session_id") != session_id:
                    continue
                upload_id = meta.get("id") or entry.name
                name = meta.get("name", "")
                if not (entry / name).is_file():
                    continue
                m = meta.get("mime", "application/octet-stream")
                results.append({
                    "name": name,
                    "url": f"/api/upload/{upload_id}/{name}",
                    "mime": m,
                    "is_image": bool(meta.get("is_image") or m.startswith("image/")),
                    "is_audio": bool(meta.get("is_audio") or m.startswith("audio/")),
                    "is_video": bool(meta.get("is_video") or m.startswith("video/")),
                    "uploaded_at": meta.get("uploaded_at", 0),
                })
    except FileNotFoundError:
        pass

    results.sort(key=lambda x: x["uploaded_at"])
    return web.json_response({"attachments": results})


@router.get(r"/api/upload/{upload_id}/{name}")
async def handle_download(request: web.Request) -> web.StreamResponse:
    upload_id = request.match_info["upload_id"]
    name = request.match_info["name"]
    if not _SAFE_NAME_RE.match(upload_id) or not _SAFE_NAME_RE.match(name):
        return web.json_response({"error": "invalid_path"}, status=400)
    entry = _entry_dir(upload_id)
    path = entry / name
    if not path.is_file():
        return web.json_response({"error": "not_found"}, status=404)
    # Read mime from sidecar — never trust the URL alone.
    meta_path = _meta_path(upload_id, name)
    mime = "application/octet-stream"
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text("utf-8"))
            mime = str(meta.get("mime") or mime)
        except Exception:
            logger.debug("[hms.upload] sidecar parse failed for %s", path, exc_info=True)
    return web.FileResponse(path, headers={"Content-Type": mime})


@router.patch(r"/api/upload/{upload_id}/meta")
async def handle_update_meta(request: web.Request) -> web.Response:
    """Tag-after-the-fact for images uploaded before activeSessionId existed."""
    upload_id = request.match_info["upload_id"]
    if not _SAFE_NAME_RE.match(upload_id):
        return web.json_response({"error": "invalid_id"}, status=400)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    session_id = body.get("session_id", "")
    if not isinstance(session_id, str) or not SESSION_ID_RE.match(session_id):
        return web.json_response({"error": "invalid_session_id"}, status=400)
    entry = _entry_dir(upload_id)
    if not entry.is_dir():
        return web.json_response({"error": "not_found"}, status=404)
    updated = 0
    for meta_file in entry.glob("*.meta.json"):
        try:
            meta = json.loads(meta_file.read_text("utf-8"))
            meta["session_id"] = session_id
            meta_file.write_text(json.dumps(meta, ensure_ascii=False), "utf-8")
            updated += 1
        except Exception:
            logger.debug("[hms.upload] meta update failed for %s", meta_file, exc_info=True)
    return web.json_response({"ok": True, "updated": updated})


@router.delete(r"/api/upload/{upload_id}")
async def handle_delete(request: web.Request) -> web.Response:
    upload_id = request.match_info["upload_id"]
    if not _SAFE_NAME_RE.match(upload_id):
        return web.json_response({"error": "invalid_id"}, status=400)
    entry = _entry_dir(upload_id)
    if not entry.is_dir():
        return web.json_response({"ok": True, "removed": False}, status=200)
    # Best-effort; GC retries on partial failure.
    removed = 0
    for p in sorted(entry.glob("*"), reverse=True):
        try:
            p.unlink()
            removed += 1
        except OSError:
            logger.exception("[hms.upload] failed to unlink %s", p)
    try:
        entry.rmdir()
    except OSError:
        logger.debug("[hms.upload] dir rmdir failed (non-empty?)", exc_info=True)
    return web.json_response({"ok": True, "removed": removed > 0})


async def _gc_loop() -> None:
    """24h sweep; retention window read from config_reader at each tick."""
    logger.info("[hms.upload] GC loop started (every %ds)", _GC_INTERVAL_S)
    try:
        while True:
            await asyncio.sleep(_GC_INTERVAL_S)
            cutoff = time.time() - config_reader.upload_retention_days() * 86400
            root = uploads_root()
            try:
                for entry in root.iterdir():
                    if not entry.is_dir():
                        continue
                    try:
                        if entry.stat().st_mtime < cutoff:
                            for p in entry.glob("*"):
                                p.unlink(missing_ok=True)
                            entry.rmdir()
                            logger.info("[hms.upload] GC swept %s", entry.name)
                    except OSError:
                        logger.exception("[hms.upload] GC failed for %s", entry)
            except FileNotFoundError:
                pass
    except asyncio.CancelledError:
        logger.info("[hms.upload] GC loop cancelled")
        raise


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach", "_gc_loop", "uploads_root"]
