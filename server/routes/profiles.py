"""Profile endpoints — full CRUD + SOUL.md + sticky active.

Station runs in the same process as upstream's ``hermes_cli`` so we
call its Python API directly instead of routing through the dashboard's
HTTP proxy. The dashboard's serializer ``_profile_to_dict`` deliberately
omits ``gateway_running`` / ``alias_path`` / ``distribution_*`` — going
in-process gives us the full ``ProfileInfo`` dataclass with no dashboard
runtime dependency.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from pathlib import Path
from typing import Any

import yaml
from aiohttp import web

from server.lib import yaml_edit
from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

# Matches upstream profiles._PROFILE_ID_RE (lower-snake/hyphen, ≤64 chars).
_PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


# ── Helpers ──────────────────────────────────────────────────────────


def _serialize(info: Any) -> dict:
    """Project upstream's ProfileInfo dataclass to a JSON-safe dict."""
    def attr(name: str, default: Any = None) -> Any:
        return getattr(info, name, default)
    return {
        "name": attr("name", ""),
        "path": str(attr("path", "")),
        "is_default": bool(attr("is_default", False)),
        "gateway_running": bool(attr("gateway_running", False)),
        "model": attr("model"),
        "provider": attr("provider"),
        "has_env": bool(attr("has_env", False)),
        "skill_count": int(attr("skill_count", 0) or 0),
        "alias_path": str(attr("alias_path")) if attr("alias_path") else None,
        "distribution_name": attr("distribution_name"),
        "distribution_version": attr("distribution_version"),
        "distribution_source": attr("distribution_source"),
        "description": attr("description", ""),
    }


def _active_payload() -> dict:
    sticky = shim.profiles.get_active
    current = shim.profiles.get_active_name
    sticky_name = sticky() if sticky else "default"
    current_name = current() if current else sticky_name
    return {
        "sticky": sticky_name,
        "current": current_name,
        "requires_restart": sticky_name != current_name,
    }


def _profile_dir(name: str) -> Path | None:
    fn = shim.profiles.get_profile_dir
    if fn is None:
        return None
    try:
        return Path(fn(name))
    except Exception:
        return None


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _read_profile_config(profile_dir: Path) -> tuple[str, float]:
    """Read ``<profile_dir>/config.yaml`` → (text, mtime); ("", 0.0) when absent."""
    cfg = profile_dir / "config.yaml"
    if not cfg.exists():
        return "", 0.0
    return cfg.read_text(encoding="utf-8"), cfg.stat().st_mtime


def _patch_model_provider(profile_dir: Path, *, model: str | None, provider: str | None) -> None:
    """Write model/provider to ``<profile_dir>/config.yaml`` via yaml_edit.

    Idempotent — only the touched keys are rewritten. Skipped silently when
    both are None or the file is missing (profile freshly created without a
    config.yaml means upstream's defaults still apply).
    """
    if model is None and provider is None:
        return
    cfg = profile_dir / "config.yaml"
    if not cfg.is_file():
        return
    try:
        text = cfg.read_text(encoding="utf-8")
        if model is not None:
            text = yaml_edit.set_scalar_at_path(text, ["model"], model)
        if provider is not None:
            text = yaml_edit.set_scalar_at_path(text, ["provider"], provider)
        yaml_edit.write_text_atomic(cfg, text)
    except Exception:
        logger.exception("[hms.profiles] patch model/provider failed at %s", cfg)


# ── Routes ───────────────────────────────────────────────────────────


@router.get("/api/profiles")
async def list_profiles(_request: web.Request) -> web.Response:
    fn = shim.profiles.list_profiles
    if fn is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        items = fn()
    except Exception:
        logger.exception("[hms.profiles] list_profiles failed")
        return web.json_response({"error": "list_failed"}, status=500)
    return web.json_response({"profiles": [_serialize(p) for p in items or []]})


@router.post("/api/profiles")
async def create_profile(request: web.Request) -> web.Response:
    create = shim.profiles.create_profile
    seed = shim.profiles.seed_profile_skills
    if create is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)

    name = body.get("name")
    if not isinstance(name, str) or not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    clone_from = body.get("clone_from") or None
    if clone_from is not None and (
        not isinstance(clone_from, str) or not _PROFILE_ID_RE.match(clone_from)
    ):
        return web.json_response({"error": "invalid_clone_from"}, status=400)
    no_skills = bool(body.get("no_skills", False))
    model = body.get("model") or None
    provider = body.get("provider") or None
    if model is not None and not isinstance(model, str):
        return web.json_response({"error": "invalid_model"}, status=400)
    if provider is not None and not isinstance(provider, str):
        return web.json_response({"error": "invalid_provider"}, status=400)

    try:
        path = create(
            name=name,
            clone_from=clone_from,
            clone_config=bool(clone_from),
            no_skills=no_skills,
        )
        # Mirror upstream's POST /api/profiles flow — when not cloning, seed
        # bundled skills (unless no_skills opted out, which the seeder respects).
        if not clone_from and seed is not None and not no_skills:
            try:
                seed(path, quiet=True)
            except Exception:
                logger.exception("[hms.profiles] seed_profile_skills failed for %s", name)
        _patch_model_provider(Path(path), model=model, provider=provider)
    except (ValueError, FileExistsError, FileNotFoundError) as exc:
        return web.json_response({"error": "create_failed", "detail": str(exc)}, status=400)
    except Exception as exc:
        logger.exception("[hms.profiles] create_profile(%r) failed", name)
        return web.json_response({"error": "create_failed", "detail": str(exc)}, status=500)
    return web.json_response({"ok": True, "name": name, "path": str(path)})


@router.patch("/api/profiles/{name}")
async def rename_profile(request: web.Request) -> web.Response:
    fn = shim.profiles.rename_profile
    if fn is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    new_name = body.get("new_name")
    if not isinstance(new_name, str) or not _PROFILE_ID_RE.match(new_name):
        return web.json_response({"error": "invalid_new_name"}, status=400)
    try:
        path = fn(name, new_name)
    except FileNotFoundError as exc:
        return web.json_response({"error": "profile_not_found", "detail": str(exc)}, status=404)
    except (ValueError, FileExistsError) as exc:
        return web.json_response({"error": "rename_failed", "detail": str(exc)}, status=400)
    except Exception as exc:
        logger.exception("[hms.profiles] rename %r → %r failed", name, new_name)
        return web.json_response({"error": "rename_failed", "detail": str(exc)}, status=500)
    return web.json_response({"ok": True, "name": new_name, "path": str(path)})


@router.delete("/api/profiles/{name}")
async def delete_profile(request: web.Request) -> web.Response:
    fn = shim.profiles.delete_profile
    if fn is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    try:
        path = fn(name, yes=True)
    except FileNotFoundError as exc:
        return web.json_response({"error": "profile_not_found", "detail": str(exc)}, status=404)
    except Exception as exc:
        logger.exception("[hms.profiles] delete %r failed", name)
        return web.json_response({"error": "delete_failed", "detail": str(exc)}, status=500)
    return web.json_response({"ok": True, "path": str(path)})


@router.get("/api/profiles/{name}/soul")
async def get_soul(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    profile_dir = _profile_dir(name)
    if profile_dir is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    soul = profile_dir / "SOUL.md"
    if not soul.is_file():
        return web.json_response({"content": "", "exists": False})
    try:
        return web.json_response({"content": soul.read_text(encoding="utf-8"), "exists": True})
    except OSError as exc:
        return web.json_response({"error": "read_failed", "detail": str(exc)}, status=500)


@router.put("/api/profiles/{name}/soul")
async def put_soul(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    profile_dir = _profile_dir(name)
    if profile_dir is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    content = body.get("content")
    if not isinstance(content, str):
        return web.json_response({"error": "invalid_content"}, status=400)
    try:
        yaml_edit.write_text_atomic(profile_dir / "SOUL.md", content)
    except OSError as exc:
        return web.json_response({"error": "write_failed", "detail": str(exc)}, status=500)
    return web.json_response({"ok": True})


# Per-profile memory docs live under ``<profile_dir>/memories/``. Each profile
# is its own HERMES_HOME, so these are distinct from any other profile's.
_MEMORY_FILES = {"memory": "MEMORY.md", "user": "USER.md"}
_MAX_MEMORY_BYTES = 5 * 1024 * 1024


def _memory_path(name: str, tab: str) -> Path | None:
    filename = _MEMORY_FILES.get(tab)
    if filename is None:
        return None
    profile_dir = _profile_dir(name)
    if profile_dir is None:
        return None
    return profile_dir / "memories" / filename


@router.get("/api/profiles/{name}/memory/{tab}")
async def get_memory(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    tab = request.match_info["tab"]
    if tab not in _MEMORY_FILES:
        return web.json_response({"error": "unknown_tab"}, status=400)
    path = _memory_path(name, tab)
    if path is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    if not path.is_file():
        return web.json_response({"content": "", "exists": False})
    try:
        return web.json_response({"content": path.read_text(encoding="utf-8"), "exists": True})
    except OSError as exc:
        return web.json_response({"error": "read_failed", "detail": str(exc)}, status=500)


@router.put("/api/profiles/{name}/memory/{tab}")
async def put_memory(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    tab = request.match_info["tab"]
    if tab not in _MEMORY_FILES:
        return web.json_response({"error": "unknown_tab"}, status=400)
    path = _memory_path(name, tab)
    if path is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    content = body.get("content")
    if not isinstance(content, str):
        return web.json_response({"error": "invalid_content"}, status=400)
    if len(content.encode("utf-8")) > _MAX_MEMORY_BYTES:
        return web.json_response({"error": "content_too_large"}, status=413)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        yaml_edit.write_text_atomic(path, content)
    except OSError as exc:
        return web.json_response({"error": "write_failed", "detail": str(exc)}, status=500)
    return web.json_response({"ok": True})


@router.get("/api/profiles/active")
async def get_active(_request: web.Request) -> web.Response:
    if shim.profiles.get_active is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    return web.json_response(_active_payload())


@router.post("/api/profiles/active")
async def post_active(request: web.Request) -> web.Response:
    set_active = shim.profiles.set_active
    if set_active is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    name = body.get("name")
    if not isinstance(name, str) or not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    try:
        set_active(name)
    except FileNotFoundError as exc:
        return web.json_response({"error": "profile_not_found", "detail": str(exc)}, status=404)
    except Exception:
        logger.exception("[hms.profiles] set_active_profile(%r) failed", name)
        return web.json_response({"error": "set_failed"}, status=500)
    return web.json_response(_active_payload())


# ── Per-Profile config.yaml (Advanced tab) ───────────────────────────
# Each Profile is its own HERMES_HOME with its own config.yaml; the Advanced
# tab edits the SELECTED profile's file directly (the default profile resolves
# to ~/.hermes/config.yaml). Same raw-YAML + sha256 optimistic-lock contract as
# /api/config/yaml, but profile-scoped — the dashboard can only reach the
# active profile, so we go straight to the file.

@router.get("/api/profiles/{name}/config")
async def get_profile_config(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    profile_dir = _profile_dir(name)
    if profile_dir is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        text, mtime = await asyncio.to_thread(_read_profile_config, profile_dir)
    except OSError:
        logger.exception("[hms.profiles] config read failed for %r", name)
        return web.json_response({"error": "read_failed"}, status=500)
    return web.json_response({
        "yaml": text,
        "sha256": _sha256(text),
        "mtime": mtime,
        "path": str(profile_dir / "config.yaml"),
    })


@router.put("/api/profiles/{name}/config")
async def put_profile_config(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    profile_dir = _profile_dir(name)
    if profile_dir is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)
    yaml_text = body.get("yaml_text")
    expected = body.get("expected_sha256")
    if not isinstance(yaml_text, str):
        return web.json_response({"error": "yaml_text_required"}, status=400)
    if not isinstance(expected, str) or not expected:
        return web.json_response({"error": "expected_sha256_required"}, status=400)
    # Validate YAML syntax before writing (parity with the dashboard editor's 400).
    try:
        yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        return web.json_response({"error": "invalid_yaml", "detail": str(exc)}, status=400)
    try:
        current, _mtime = await asyncio.to_thread(_read_profile_config, profile_dir)
    except OSError:
        current = ""
    current_sha = _sha256(current)
    if current_sha != expected:
        return web.json_response({"error": "conflict", "current_sha256": current_sha}, status=409)
    cfg = profile_dir / "config.yaml"
    try:
        await asyncio.to_thread(yaml_edit.write_text_atomic, cfg, yaml_text)
    except OSError:
        logger.exception("[hms.profiles] config write failed for %r", name)
        return web.json_response({"error": "write_failed"}, status=500)
    # If we just edited the active HERMES_HOME's config, refresh Station's cache.
    try:
        from server.lib import config_reader
        from server.lib.upstream_paths import hermes_home
        if cfg.resolve() == (hermes_home() / "config.yaml").resolve():
            config_reader.reload()
    except Exception:
        logger.debug("[hms.profiles] config_reader.reload skipped", exc_info=True)
    return web.json_response({"ok": True, "sha256": _sha256(yaml_text)})


# FORM mode reads/writes the SAME per-profile config.yaml by dot-path. The
# schema is static (served by the dashboard at /api/dashboard/config/schema);
# only the values are profile-scoped, so they live here. Writes go through
# yaml_edit.set_scalar_at_path → comments + key ordering are preserved.

@router.get("/api/profiles/{name}/config/values")
async def get_profile_config_values(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    profile_dir = _profile_dir(name)
    if profile_dir is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        text, _mtime = await asyncio.to_thread(_read_profile_config, profile_dir)
    except OSError:
        logger.exception("[hms.profiles] config read failed for %r", name)
        return web.json_response({"error": "read_failed"}, status=500)
    try:
        values = yaml.safe_load(text) or {}
    except yaml.YAMLError:
        values = {}
    if not isinstance(values, dict):
        values = {}
    # sha256 is of the RAW text so FORM and YAML modes share one optimistic lock.
    return web.json_response({"values": values, "sha256": _sha256(text)})


@router.put("/api/profiles/{name}/config/values")
async def put_profile_config_values(request: web.Request) -> web.Response:
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    profile_dir = _profile_dir(name)
    if profile_dir is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)
    updates = body.get("updates")
    expected = body.get("expected_sha256")
    if not isinstance(updates, dict) or not updates:
        return web.json_response({"error": "updates_required"}, status=400)
    if not isinstance(expected, str) or not expected:
        return web.json_response({"error": "expected_sha256_required"}, status=400)
    # Each key is a dot-path; reject empty segments (yaml_edit needs real keys).
    for dotpath in updates:
        if (
            not isinstance(dotpath, str)
            or not dotpath
            or not all(seg for seg in dotpath.split("."))
        ):
            return web.json_response({"error": "invalid_path", "detail": str(dotpath)}, status=400)
    try:
        current, _mtime = await asyncio.to_thread(_read_profile_config, profile_dir)
    except OSError:
        current = ""
    current_sha = _sha256(current)
    if current_sha != expected:
        return web.json_response({"error": "conflict", "current_sha256": current_sha}, status=409)
    src = current
    for dotpath, value in updates.items():
        src = yaml_edit.set_scalar_at_path(src, tuple(dotpath.split(".")), value)
    # Validate the merged result still parses before persisting.
    try:
        yaml.safe_load(src)
    except yaml.YAMLError as exc:
        return web.json_response({"error": "invalid_yaml", "detail": str(exc)}, status=400)
    cfg = profile_dir / "config.yaml"
    try:
        await asyncio.to_thread(yaml_edit.write_text_atomic, cfg, src)
    except OSError:
        logger.exception("[hms.profiles] config values write failed for %r", name)
        return web.json_response({"error": "write_failed"}, status=500)
    try:
        from server.lib import config_reader
        from server.lib.upstream_paths import hermes_home
        if cfg.resolve() == (hermes_home() / "config.yaml").resolve():
            config_reader.reload()
    except Exception:
        logger.debug("[hms.profiles] config_reader.reload skipped", exc_info=True)
    return web.json_response({"ok": True, "sha256": _sha256(src)})


@router.get("/api/profiles/{name}/personalities")
async def get_profile_personalities(request: web.Request) -> web.Response:
    """A profile's defined personality overlays (``agent.personalities`` in its
    config.yaml). Each is a name → prompt; the prompt may be a plain string or a
    ``{description, system_prompt}`` dict. Read-only — the *active* overlay is a
    runtime, per-chat choice (the ``/personality`` picker), not a profile setting."""
    name = request.match_info["name"]
    if not _PROFILE_ID_RE.match(name):
        return web.json_response({"error": "invalid_profile_name"}, status=400)
    profile_dir = _profile_dir(name)
    if profile_dir is None:
        return web.json_response({"error": "upstream_unavailable"}, status=503)
    try:
        text, _mtime = await asyncio.to_thread(_read_profile_config, profile_dir)
    except OSError:
        logger.exception("[hms.profiles] config read failed for %r", name)
        return web.json_response({"error": "read_failed"}, status=500)
    try:
        cfg = yaml.safe_load(text) or {}
    except yaml.YAMLError:
        cfg = {}
    raw: dict = {}
    if isinstance(cfg, dict):
        agent = cfg.get("agent")
        if isinstance(agent, dict) and isinstance(agent.get("personalities"), dict):
            raw = agent["personalities"]
    out = []
    for pname, val in raw.items():
        if isinstance(val, dict):
            description = str(val.get("description") or "")
            prompt = str(val.get("system_prompt") or "")
        else:
            description = ""
            prompt = str(val or "")
        out.append({"name": str(pname), "description": description, "prompt": prompt})
    return web.json_response({"personalities": out})


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
