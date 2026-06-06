"""File browser endpoints scoped to two whitelisted roots: ``hermes``
(``~/.hermes``) and ``workspace`` — a switchable "current directory" that
defaults to the user's home (``~/``) and is confined under home (option A)."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
import shutil
import subprocess
import uuid
from pathlib import Path

from aiohttp import web

from server.lib import upstream_paths

logger = logging.getLogger(__name__)


# ── Workspace persistence ─────────────────────────────────────────────

def _workspaces_file() -> Path:
    from server.lib import upstream_paths  # local import avoids circular at module load
    return upstream_paths.hms_data_dir() / "workspaces.json"


_workspace_cache: dict | None = None


def _load_workspaces() -> dict:
    global _workspace_cache
    if _workspace_cache is not None:
        return _workspace_cache
    p = _workspaces_file()
    try:
        data = json.loads(p.read_text()) if p.exists() else {}
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    _workspace_cache = data
    return data


def _save_workspaces(data: dict) -> None:
    global _workspace_cache
    p = _workspaces_file()
    p.write_text(json.dumps(data, indent=2))
    _workspace_cache = data


_SYSTEM_BLOCKS = {
    "/", "/etc", "/usr", "/bin", "/sbin", "/sys", "/proc", "/dev", "/boot", "/lib", "/lib64",
}


def _validate_workspace_path(path_str: str) -> tuple[Path | None, str | None]:
    try:
        p = Path(path_str).expanduser().resolve()
    except Exception:
        return None, "invalid_path"
    if not p.exists():
        return None, "not_found"
    if not p.is_dir():
        return None, "not_a_directory"
    if str(p) in _SYSTEM_BLOCKS or p == Path.home():
        return None, "system_path"
    return p, None


# ── Core path resolution ──────────────────────────────────────────────

_MAX_READ_BYTES = 1 * 1024 * 1024
_MAX_WRITE_BYTES = 1 * 1024 * 1024
_TEXT_SNIFF_BYTES = 8 * 1024

_BLOCKED_RE = re.compile(
    r"(^|/)("
    r"\.env(\.[\w\-]+)?"
    r"|auth\.json"
    r"|honcho\.json"
    r"|[^/]+\.pem"
    r"|[^/]+\.key"
    r"|id_rsa(\.pub)?"
    r"|id_ed25519(\.pub)?"
    r")$",
    re.IGNORECASE,
)


# Sentinel active_id meaning "the Hermes home itself is the agent cwd" — lets
# the file-tree's ~/.hermes selection also drive TERMINAL_CWD, instead of only
# switching the browse root while the agent stays on the prior workspace.
HERMES_ACTIVE_ID = "hermes"


def active_workspace() -> tuple[str | None, Path | None]:
    """The user-selected active workspace as ``(name, abs_path)``.

    Returns ``(None, None)`` when no workspace is explicitly active or the
    stored path is gone. Used by the run pipeline to make the agent aware of
    its working directory (see ``server.runs``). The special ``"hermes"``
    active_id resolves to ``$HERMES_HOME``; otherwise it's a custom workspace.
    Distinct from the ``~/workspace`` fallback that ``_root_path`` uses for the
    file browser.
    """
    data = _load_workspaces()
    active_id = data.get("active_id")
    if not active_id:
        return None, None
    if active_id == HERMES_ACTIVE_ID:
        return HERMES_ACTIVE_ID, upstream_paths.hermes_home()
    for ws in data.get("workspaces", []):
        if ws.get("id") != active_id:
            continue
        try:
            p = Path(ws["path"]).expanduser().resolve()
            if p.is_dir():
                return (ws.get("name") or p.name), p
        except Exception:
            return None, None
    return None, None


def _home() -> Path:
    return Path.home().resolve()


def _under_home(p: Path) -> bool:
    """Option A confinement: the file browser is bounded by the user's home."""
    home = _home()
    return p == home or home in p.parents


def _current_dir_raw() -> Path | None:
    """The persisted browse directory, or ``None`` when unset/invalid/escaped.
    ``None`` means "no explicit choice" — used by the agent-cwd resolver to fall
    back to its legacy default instead of forcing home."""
    data = _load_workspaces()
    raw = data.get("current_dir")
    if isinstance(raw, str) and raw.strip():
        try:
            p = Path(raw).expanduser().resolve()
            if p.is_dir() and _under_home(p):
                return p
        except Exception:  # noqa: S110 — best-effort; treat as unset
            pass
    return None


def _current_dir() -> Path:
    """The file browser's current ``workspace`` directory — the persisted choice
    or, by default, the user's home (``~/``)."""
    return _current_dir_raw() or _home()


def _validate_dir_under_home(path_str: str) -> tuple[Path | None, str | None]:
    """A browse-dir target: must exist, be a directory, and live under ``~/``."""
    try:
        p = Path(path_str).expanduser().resolve()
    except Exception:
        return None, "invalid_path"
    if not p.exists():
        return None, "not_found"
    if not p.is_dir():
        return None, "not_a_directory"
    if not _under_home(p):
        return None, "outside_home"
    return p, None


def _root_path(name: str) -> Path | None:
    if name == "hermes":
        return upstream_paths.hermes_home().resolve()
    if name == "workspace":
        return _current_dir()
    return None


def _resolve_safe_path(root_name: str, rel: str) -> Path:
    """Raises ValueError for unknown root, traversal outside, or blocked-name patterns."""
    root = _root_path(root_name)
    if root is None:
        raise ValueError("unknown_root")

    # lstrip("./") would strip any combo of . and / — that would turn ".env" into "env"
    # and slip past the blocked filter, so handle the two prefixes explicitly.
    safe_rel = (rel or "").strip()
    if safe_rel.startswith("/"):
        safe_rel = safe_rel.lstrip("/")
    if safe_rel.startswith("./"):
        safe_rel = safe_rel[2:]
    candidate = (root / safe_rel).resolve() if safe_rel else root

    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("path_outside_root") from exc

    if _BLOCKED_RE.search(str(candidate)):
        raise ValueError("blocked_name")

    return candidate


def _is_blocked(name: str) -> bool:
    return _BLOCKED_RE.search(name) is not None


def _sniff_binary(path: Path) -> bool:
    """NUL byte in the first 8 KiB → binary. Sync helper, wrapped by handlers."""
    try:
        with path.open("rb") as f:
            chunk = f.read(_TEXT_SNIFF_BYTES)
        return b"\x00" in chunk
    except Exception:
        return True


# Plain functions (not closures) so tests can monkey-patch them.

def _list_directory(target: Path) -> tuple[list[dict] | None, str | None]:
    entries: list[dict] = []
    try:
        children = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError:
        return None, "permission_denied"
    for child in children:
        if _is_blocked(child.name):
            continue
        try:
            st = child.stat()
        except FileNotFoundError:
            continue
        kind = "dir" if child.is_dir() else "file"
        entries.append({
            "name": child.name,
            "kind": kind,
            "size": st.st_size if kind == "file" else 0,
            "mtime": int(st.st_mtime),
        })
    return entries, None


def _read_file_payload(
    target: Path, root_name: str, rel: str,
) -> tuple[dict | None, int | None, str | None]:
    """Returns (payload, http_status, error_code); exactly one of payload/error is non-None."""
    try:
        size = target.stat().st_size
    except OSError as exc:
        logger.warning("[hms.files] stat failed for %s: %s", target, exc)
        return None, 500, "stat_failed"
    if size > _MAX_READ_BYTES:
        return (
            {"error": "too_large", "size": size, "limit": _MAX_READ_BYTES},
            413, None,
        )

    binary = _sniff_binary(target)
    try:
        raw = target.read_bytes()
    except OSError as exc:
        logger.warning("[hms.files] read failed for %s: %s", target, exc)
        return None, 500, "read_failed"

    mtime = int(target.stat().st_mtime)
    if binary:
        return ({
            "root": root_name, "path": rel,
            "binary": True, "size": size,
            "content_b64": base64.b64encode(raw).decode("ascii"),
            "mtime": mtime,
        }, None, None)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return ({
            "root": root_name, "path": rel,
            "binary": True, "size": size,
            "content_b64": base64.b64encode(raw).decode("ascii"),
            "mtime": mtime,
        }, None, None)

    return ({
        "root": root_name, "path": rel,
        "binary": False, "size": size,
        "content": text, "mtime": mtime,
    }, None, None)


def _write_file(target: Path, encoded: bytes) -> tuple[bool, str | None]:
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.write_bytes(encoded)
    except OSError as exc:
        logger.warning("[hms.files] write failed for %s: %s", target, exc)
        return False, "write_failed"
    return True, None


def _delete_file(target: Path) -> str | None:
    try:
        if target.is_dir():
            try:
                target.rmdir()
            except OSError:
                return "directory_not_empty"
        else:
            target.unlink()
    except OSError as exc:
        logger.warning("[hms.files] delete failed for %s: %s", target, exc)
        return "delete_failed"
    return None


def _rename_file(source: Path, dest: Path) -> str | None:
    try:
        shutil.move(str(source), str(dest))
    except OSError as exc:
        logger.warning("[hms.files] rename failed: %s", exc)
        return "rename_failed"
    return None


router = web.RouteTableDef()


@router.get("/api/files/tree")
async def get_tree(request: web.Request) -> web.Response:
    root_name = (request.query.get("root") or "hermes").strip()
    rel = (request.query.get("path") or "").strip()
    try:
        target = _resolve_safe_path(root_name, rel)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)

    if not target.exists():
        return web.json_response({"error": "not_found"}, status=404)
    if not target.is_dir():
        return web.json_response({"error": "not_a_directory"}, status=400)

    entries, err = await asyncio.to_thread(_list_directory, target)
    if err is not None:
        return web.json_response({"error": err}, status=403)
    return web.json_response({"root": root_name, "path": rel, "entries": entries})


@router.get("/api/files/read")
async def get_read(request: web.Request) -> web.Response:
    root_name = (request.query.get("root") or "hermes").strip()
    rel = (request.query.get("path") or "").strip()
    try:
        target = _resolve_safe_path(root_name, rel)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)

    if not target.exists():
        return web.json_response({"error": "not_found"}, status=404)
    if not target.is_file():
        return web.json_response({"error": "not_a_file"}, status=400)

    payload, status, err = await asyncio.to_thread(
        _read_file_payload, target, root_name, rel,
    )
    if err is not None:
        return web.json_response({"error": err}, status=status or 500)
    if status is not None:
        return web.json_response(payload, status=status)
    return web.json_response(payload)


@router.put("/api/files/write")
async def put_write(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json_required"}, status=400)

    root_name = (body.get("root") or "").strip()
    rel = (body.get("path") or "").strip()
    content = body.get("content")
    if content is None or not isinstance(content, str):
        return web.json_response({"error": "content_required"}, status=400)

    encoded = content.encode("utf-8")
    if len(encoded) > _MAX_WRITE_BYTES:
        return web.json_response(
            {"error": "too_large", "size": len(encoded), "limit": _MAX_WRITE_BYTES},
            status=413,
        )

    try:
        target = _resolve_safe_path(root_name, rel)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)

    ok, err = await asyncio.to_thread(_write_file, target, encoded)
    if not ok:
        return web.json_response({"error": err or "write_failed"}, status=500)
    mtime = await asyncio.to_thread(lambda: int(target.stat().st_mtime))
    return web.json_response({
        "ok": True,
        "root": root_name,
        "path": rel,
        "size": len(encoded),
        "mtime": mtime,
    })


@router.delete("/api/files/delete")
async def delete_file(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json_required"}, status=400)

    root_name = (body.get("root") or "").strip()
    rel = (body.get("path") or "").strip()
    try:
        target = _resolve_safe_path(root_name, rel)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)

    if not target.exists():
        return web.json_response({"error": "not_found"}, status=404)

    root_abs = _root_path(root_name)
    if root_abs and target == root_abs:
        return web.json_response({"error": "cannot_delete_root"}, status=400)

    err = await asyncio.to_thread(_delete_file, target)
    if err == "directory_not_empty":
        return web.json_response({"error": err}, status=400)
    if err is not None:
        return web.json_response({"error": err}, status=500)
    return web.json_response({"ok": True, "root": root_name, "path": rel})


@router.post("/api/files/rename")
async def post_rename(request: web.Request) -> web.Response:
    """new_name is basename only — cross-directory moves are forbidden by design."""
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json_required"}, status=400)

    root_name = (body.get("root") or "").strip()
    rel = (body.get("path") or "").strip()
    new_name = (body.get("new_name") or "").strip()
    if not new_name or "/" in new_name or new_name in {".", ".."}:
        return web.json_response({"error": "invalid_new_name"}, status=400)
    if _is_blocked(new_name):
        return web.json_response({"error": "blocked_name"}, status=400)

    try:
        source = _resolve_safe_path(root_name, rel)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)

    if not source.exists():
        return web.json_response({"error": "not_found"}, status=404)

    dest = source.parent / new_name
    try:
        dest = dest.resolve()
        root_abs = _root_path(root_name)
        if root_abs is None or not str(dest).startswith(str(root_abs) + "/") and dest != root_abs:
            raise ValueError("path_outside_root")
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)

    if dest.exists():
        return web.json_response({"error": "destination_exists"}, status=409)

    err = await asyncio.to_thread(_rename_file, source, dest)
    if err is not None:
        return web.json_response({"error": err}, status=500)

    new_rel = str(dest.relative_to(_root_path(root_name)))  # type: ignore[arg-type]
    mtime = await asyncio.to_thread(lambda: int(dest.stat().st_mtime))
    return web.json_response({
        "ok": True,
        "root": root_name,
        "path": new_rel,
        "mtime": mtime,
    })


@router.post("/api/files/mkdir")
async def post_mkdir(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json_required"}, status=400)

    root_name = (body.get("root") or "").strip()
    rel = (body.get("path") or "").strip()
    if not rel:
        return web.json_response({"error": "path_required"}, status=400)

    try:
        target = _resolve_safe_path(root_name, rel)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)

    if target.exists():
        return web.json_response({"error": "already_exists"}, status=409)

    try:
        await asyncio.to_thread(target.mkdir, True, False)
    except OSError as exc:
        logger.warning("[hms.files] mkdir failed for %s: %s", target, exc)
        return web.json_response({"error": "mkdir_failed"}, status=500)

    return web.json_response({"ok": True, "root": root_name, "path": rel})


def _git_info(root: Path) -> dict:
    """Return git metadata for *root*; empty dict if not a git repo or git unavailable."""
    def run(args: list[str]) -> str:
        try:
            return subprocess.check_output(
                ["git"] + args,
                cwd=str(root),
                stderr=subprocess.DEVNULL,
                timeout=3,
            ).decode().strip()
        except Exception:
            return ""

    branch = run(["rev-parse", "--abbrev-ref", "HEAD"])
    if not branch or branch == "HEAD":
        return {}

    status_out = run(["status", "--porcelain"])
    dirty = len([ln for ln in status_out.splitlines() if ln.strip()])

    ahead = behind = 0
    rev_list = run(["rev-list", "--left-right", "--count", "HEAD...@{u}"])
    if rev_list:
        parts = rev_list.split()
        if len(parts) == 2:
            try:
                ahead, behind = int(parts[0]), int(parts[1])
            except ValueError:
                pass

    return {"branch": branch, "dirty": dirty, "ahead": ahead, "behind": behind}


@router.get("/api/files/git-info")
async def get_git_info(request: web.Request) -> web.Response:
    root_name = (request.query.get("root") or "workspace").strip()
    root = _root_path(root_name)
    if root is None:
        return web.json_response({"error": "unknown_root"}, status=400)
    if not root.exists():
        return web.json_response({})
    info = await asyncio.to_thread(_git_info, root)
    return web.json_response(info)


def _git_file_log(root: Path, rel: str, limit: int = 20) -> list[dict]:
    """Return git commit log for a specific file; empty list if not tracked or git unavailable."""
    try:
        out = subprocess.check_output(
            [
                "git", "log",
                f"--max-count={limit}",
                "--format=%H\x1f%s\x1f%an\x1f%ai\x1f%ar",
                "--follow", "--", rel,
            ],
            cwd=str(root),
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).decode(errors="replace").strip()
    except Exception:
        return []
    if not out:
        return []
    entries = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) < 5:
            continue
        entries.append({
            "hash": parts[0],
            "subject": parts[1],
            "author": parts[2],
            "date": parts[3],
            "relative": parts[4],
        })
    return entries


def _git_file_show(root: Path, rel: str, ref: str) -> tuple[str | None, str | None]:
    """Return file content at *ref*; (None, error_code) on failure."""
    # Validate ref is a safe hex-ish string (sha, branch, tag) — no shell injection
    if not re.fullmatch(r"[0-9a-fA-F]{4,40}|[a-zA-Z0-9_.\-/]+", ref):
        return None, "invalid_ref"
    try:
        content = subprocess.check_output(
            ["git", "show", f"{ref}:{rel}"],
            cwd=str(root),
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        if len(content) > _MAX_READ_BYTES:
            return None, "too_large"
        return content.decode(errors="replace"), None
    except subprocess.CalledProcessError:
        return None, "not_found"
    except Exception:
        return None, "git_error"


@router.get("/api/files/log")
async def get_file_log(request: web.Request) -> web.Response:
    root_name = (request.query.get("root") or "workspace").strip()
    rel = (request.query.get("path") or "").strip()
    limit_str = (request.query.get("limit") or "20").strip()
    try:
        limit = max(1, min(100, int(limit_str)))
    except ValueError:
        limit = 20
    if not rel:
        return web.json_response({"error": "path_required"}, status=400)
    try:
        _resolve_safe_path(root_name, rel)  # validate root + path
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    root = _root_path(root_name)
    if root is None:
        return web.json_response({"error": "unknown_root"}, status=400)
    entries = await asyncio.to_thread(_git_file_log, root, rel, limit)
    return web.json_response({"entries": entries})


@router.get("/api/files/show")
async def get_file_show(request: web.Request) -> web.Response:
    root_name = (request.query.get("root") or "workspace").strip()
    rel = (request.query.get("path") or "").strip()
    ref = (request.query.get("ref") or "").strip()
    if not rel or not ref:
        return web.json_response({"error": "path_and_ref_required"}, status=400)
    try:
        _resolve_safe_path(root_name, rel)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    root = _root_path(root_name)
    if root is None:
        return web.json_response({"error": "unknown_root"}, status=400)
    content, err = await asyncio.to_thread(_git_file_show, root, rel, ref)
    if err is not None:
        status = 413 if err == "too_large" else 404 if err == "not_found" else 400
        return web.json_response({"error": err}, status=status)
    return web.json_response({"root": root_name, "path": rel, "ref": ref, "content": content})


# ── Workspace management endpoints ────────────────────────────────────

@router.get("/api/files/workspaces")
async def list_workspaces(request: web.Request) -> web.Response:
    data = await asyncio.to_thread(_load_workspaces)
    ws_list = data.get("workspaces", [])
    active_id = data.get("active_id")
    return web.json_response({"active_id": active_id, "workspaces": ws_list})


@router.get("/api/files/workspace/active")
async def get_active_workspace(request: web.Request) -> web.Response:
    """The agent's effective working directory + a short label for the UI.

    ``cwd`` is the *agent's* resolved working dir (the same path that seeds
    ``TERMINAL_CWD`` and the per-run workspace preface): a chosen workspace,
    else ``~/workspace``, else ``$HERMES_HOME``. ``name`` is the chosen
    workspace's label, or ``None`` for the default. Lets the chat header show
    "working in: <name>" so the file-tree *root* (which the user can browse
    independently) is never confused with where the agent actually runs.
    """
    from server.lib.workspace_cwd import resolve_active_cwd

    def _resolve() -> tuple[str | None, str]:
        name, _ = active_workspace()
        cwd = resolve_active_cwd()
        return name, str(cwd)

    name, cwd = await asyncio.to_thread(_resolve)
    return web.json_response({"name": name, "cwd": cwd})


@router.post("/api/files/workspaces")
async def add_workspace(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    path_str = (body.get("path") or "").strip()
    name = (body.get("name") or "").strip()
    if not path_str:
        return web.json_response({"error": "path_required"}, status=400)

    resolved, err = await asyncio.to_thread(_validate_workspace_path, path_str)
    if err:
        return web.json_response({"error": err}, status=422)

    data = await asyncio.to_thread(_load_workspaces)
    ws_list: list[dict] = data.get("workspaces", [])
    # Deduplicate by resolved path — resolve off-thread (blocking stat).
    target = str(resolved)
    existing = await asyncio.to_thread(
        lambda: [str(Path(w["path"]).expanduser().resolve()) for w in ws_list]
    )
    if target in existing:
        return web.json_response({"error": "already_exists"}, status=409)

    ws_list.append({
        "id": str(uuid.uuid4()),
        "name": name or str(resolved),
        "path": str(resolved),
    })
    new_data = {**data, "workspaces": ws_list}
    await asyncio.to_thread(_save_workspaces, new_data)
    return web.json_response({"active_id": new_data.get("active_id"), "workspaces": ws_list})


@router.delete("/api/files/workspaces")
async def remove_workspace(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    ws_id = (body.get("id") or "").strip()
    if not ws_id:
        return web.json_response({"error": "id_required"}, status=400)

    data = await asyncio.to_thread(_load_workspaces)
    ws_list = [w for w in data.get("workspaces", []) if w.get("id") != ws_id]
    active_id = data.get("active_id")
    if active_id == ws_id:
        active_id = None
    new_data = {**data, "active_id": active_id, "workspaces": ws_list}
    await asyncio.to_thread(_save_workspaces, new_data)
    return web.json_response({"active_id": active_id, "workspaces": ws_list})


@router.put("/api/files/workspaces/active")
async def set_active_workspace(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    ws_id = body.get("id")  # None = revert to ~/workspace; "hermes" = $HERMES_HOME
    data = await asyncio.to_thread(_load_workspaces)
    ws_list = data.get("workspaces", [])
    if (
        ws_id is not None
        and ws_id != HERMES_ACTIVE_ID
        and not any(w.get("id") == ws_id for w in ws_list)
    ):
        return web.json_response({"error": "not_found"}, status=404)
    new_data = {**data, "active_id": ws_id}
    await asyncio.to_thread(_save_workspaces, new_data)
    # Point the agent's tools (TERMINAL_CWD) at the newly active workspace.
    from server.lib.workspace_cwd import apply_active_workspace_cwd
    cwd = await asyncio.to_thread(apply_active_workspace_cwd)
    return web.json_response({"active_id": ws_id, "workspaces": ws_list, "cwd": cwd})


# ── Browse directory (the `workspace` file-browser root) ──────────────
# A single "current directory" the file browser is rooted at — defaults to the
# user's home (`~/`) and is switchable to any directory **under** home (option
# A confinement). Independent of the agent's active-workspace / cwd.

_SUBDIRS_CAP = 300


@router.get("/api/files/workspace/dir")
async def get_workspace_dir(request: web.Request) -> web.Response:
    def _resolve() -> tuple[str, str, str]:
        cur = _current_dir()
        return str(cur), str(_home()), (cur.name or str(cur))

    cur, home, name = await asyncio.to_thread(_resolve)
    return web.json_response({"dir": cur, "home": home, "name": name})


@router.put("/api/files/workspace/dir")
async def set_workspace_dir(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    path_str = (body.get("path") or "").strip()
    if not path_str:
        return web.json_response({"error": "path_required"}, status=400)

    resolved, err = await asyncio.to_thread(_validate_dir_under_home, path_str)
    if err or resolved is None:
        status = 404 if err == "not_found" else 400
        return web.json_response({"error": err or "invalid_path"}, status=status)

    def _persist() -> None:
        data = _load_workspaces()
        _save_workspaces({**data, "current_dir": str(resolved)})

    await asyncio.to_thread(_persist)
    # Make the agent aware: point TERMINAL_CWD + persist terminal.cwd at the new
    # dir, so the LLM's tools and the per-run "Current workspace" preface follow.
    from server.lib.workspace_cwd import apply_active_workspace_cwd
    cwd = await asyncio.to_thread(apply_active_workspace_cwd)
    return web.json_response({
        "dir": str(resolved),
        "home": str(_home()),
        "name": resolved.name or str(resolved),
        "cwd": cwd,
    })


@router.get("/api/files/workspace/subdirs")
async def get_workspace_subdirs(request: web.Request) -> web.Response:
    """Immediate (non-hidden) subdirectories of a dir under home — feeds the
    path switcher's drill-down — plus its parent when still under home."""
    raw = (request.query.get("path") or "").strip()

    def _resolve() -> dict | None:
        try:
            base = _current_dir() if not raw else Path(raw).expanduser().resolve()
        except Exception:
            return None
        if not (base.is_dir() and _under_home(base)):
            return None
        dirs: list[dict] = []
        try:
            children = sorted(base.iterdir(), key=lambda p: p.name.lower())
        except PermissionError:
            children = []
        for child in children:
            if len(dirs) >= _SUBDIRS_CAP:
                break
            if child.name.startswith(".") or _is_blocked(child.name):
                continue
            try:
                if child.is_dir():
                    dirs.append({"name": child.name, "path": str(child)})
            except OSError:
                continue
        parent = base.parent
        parent_str = str(parent) if (base != _home() and _under_home(parent)) else None
        return {"dir": str(base), "home": str(_home()), "parent": parent_str, "dirs": dirs}

    result = await asyncio.to_thread(_resolve)
    if result is None:
        return web.json_response({"error": "invalid_path"}, status=400)
    return web.json_response(result)


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
