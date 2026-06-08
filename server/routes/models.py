"""Model capability + key + assignment endpoints — writes proxy to Dashboard."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import defaultdict
from typing import Any

from aiohttp import web

from server.lib import config_reader
from server.lib.profile_run import profile_home_override
from server.lib.route_helpers import profile_arg
from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

_REVEAL_LIMIT = 5
_REVEAL_WINDOW_S = 30.0
_reveal_log: dict[str, list[float]] = defaultdict(list)


def _reveal_allowed(client_ip: str) -> bool:
    now = time.monotonic()
    bucket = _reveal_log[client_ip]
    bucket[:] = [t for t in bucket if now - t < _REVEAL_WINDOW_S]
    if len(bucket) >= _REVEAL_LIMIT:
        return False
    bucket.append(now)
    return True


_MASK_RE = re.compile(r"^(.{4})(.+)(.{4})$")


def _mask(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 12:
        return "*" * len(value)
    m = _MASK_RE.match(value)
    if m:
        return f"{m.group(1)}{'*' * min(len(m.group(2)), 16)}{m.group(3)}"
    return value[:4] + "*" * 8 + value[-4:]


def _build_env_vars() -> dict[str, dict] | None:
    """In-process replica of the dashboard's ``get_env_vars()``.

    Reads the current ``HERMES_HOME`` ``.env`` (honouring an active
    ``profile_home_override``) and joins it with upstream's ``OPTIONAL_ENV_VARS``
    catalog. Returns ``None`` when the upstream catalog/loader isn't importable
    (the caller surfaces that as ``env_unavailable``). Unlike the dashboard HTTP
    proxy, this sees the per-coroutine profile override, so the Keys view is
    scopable without spawning a sibling gateway.
    """
    optional = shim.env.optional_vars
    load_env = shim.env.load_env
    redact = shim.env.redact_key
    if optional is None or load_env is None or redact is None:
        return None
    try:
        on_disk = load_env()
    except Exception:
        logger.debug("[hms.models] load_env failed", exc_info=True)
        return None
    chan_fn = shim.env.channel_managed_keys
    try:
        channel_keys = chan_fn() if chan_fn is not None else frozenset()
    except Exception:
        channel_keys = frozenset()
    result: dict[str, dict] = {}
    for name, info in optional.items():
        value = on_disk.get(name)
        result[name] = {
            "is_set": bool(value),
            "redacted_value": redact(value) if value else None,
            "description": info.get("description", ""),
            "url": info.get("url"),
            "category": info.get("category", ""),
            "is_password": info.get("password", False),
            "advanced": info.get("advanced", False),
            "channel_managed": name in channel_keys,
        }
    return result


@router.get("/api/models/vision-check")
async def vision_check(request: web.Request) -> web.Response:
    model = (request.query.get("model") or "").strip()
    if not model:
        return web.json_response({"ok": False, "model": "", "source": "missing"}, status=200)

    fn = shim.models.get_capabilities
    if fn is None:
        return web.json_response({"ok": False, "model": model, "source": "unknown"}, status=200)

    try:
        caps: Any = fn(provider="", model=model)
    except Exception:
        logger.exception("[hms.models] vision-check failed for %r", model)
        return web.json_response({"ok": False, "model": model, "source": "error"}, status=200)

    if caps is None:
        return web.json_response({"ok": False, "model": model, "source": "unknown"}, status=200)

    supports = bool(getattr(caps, "supports_vision", False))
    return web.json_response({"ok": supports, "model": model, "source": "models.dev"}, status=200)


@router.get("/api/models/context")
async def model_context(request: web.Request) -> web.Response:
    """Context-window length (tokens) for a model, via models.dev. Powers the
    Composer's context ring. ``context_length`` is null when unknown."""
    model = (request.query.get("model") or "").strip()
    provider = (request.query.get("provider") or "").strip()
    if not model:
        return web.json_response({"model": "", "context_length": None}, status=200)
    ctx: int | None = None
    fn = shim.models.lookup_context
    if fn is not None:
        try:
            ctx = fn(provider, model)
        except Exception:
            logger.exception("[hms.models] context lookup failed for %r/%r", provider, model)
    # Fallback to the richer capabilities lookup (also models.dev-backed).
    if not ctx:
        caps_fn = shim.models.get_capabilities
        if caps_fn is not None:
            try:
                caps = caps_fn(provider=provider, model=model)
                ctx = getattr(caps, "context_window", None) if caps is not None else None
            except Exception:
                logger.exception(
                    "[hms.models] capabilities lookup failed for %r/%r", provider, model
                )
    return web.json_response(
        {"model": model, "context_length": int(ctx) if isinstance(ctx, int) and ctx > 0 else None},
        status=200,
    )


@router.get("/api/models/keys")
async def get_keys(request: web.Request) -> web.Response:
    profile, err = profile_arg(request)
    if err is not None:
        return err
    with profile_home_override(profile):
        env = _build_env_vars()
    if env is None:
        return web.json_response({"keys": [], "error": "env_unavailable"})

    keys = []
    for name in sorted(env.keys()):
        info = env[name]
        if not isinstance(info, dict):
            continue
        keys.append({
            "name": name,
            "masked": info.get("redacted_value") or "",
            "set": bool(info.get("is_set")),
            "category": info.get("category", "") or "other",
            "description": info.get("description", "") or "",
            "url": info.get("url") or None,
            "is_password": bool(info.get("is_password")),
            "advanced": bool(info.get("advanced")),
        })
    return web.json_response({"keys": keys})


@router.post("/api/models/keys/reveal")
async def reveal_key(request: web.Request) -> web.Response:
    peername = request.transport and request.transport.get_extra_info("peername")
    client_ip = peername[0] if peername else "unknown"

    if not _reveal_allowed(client_ip):
        return web.json_response(
            {"error": "rate_limited", "retry_after_seconds": int(_REVEAL_WINDOW_S)},
            status=429,
        )

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json_required"}, status=400)

    name = (body.get("name") or "").strip()
    if not name:
        return web.json_response({"error": "name_required"}, status=400)

    profile, err = profile_arg(request)
    if err is not None:
        return err

    load_env = shim.env.load_env
    if load_env is None:
        return web.json_response({"error": "env_unavailable"}, status=503)
    # Read the *selected* profile's .env directly (the file, not process env) so
    # a reveal while scoped to profile X never leaks the active profile's value.
    try:
        with profile_home_override(profile):
            value = (load_env() or {}).get(name)
    except Exception:
        logger.debug("[hms.models] reveal load_env failed", exc_info=True)
        value = None
    if not value:
        return web.json_response({"error": "key_not_found"}, status=404)
    return web.json_response({"name": name, "value": value})


@router.put("/api/models/keys")
async def set_key(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json_required"}, status=400)

    name = (body.get("name") or "").strip()
    value = body.get("value", "")
    if not name:
        return web.json_response({"error": "name_required"}, status=400)
    if not isinstance(value, str):
        return web.json_response({"error": "value_must_be_string"}, status=400)

    profile, err = profile_arg(request)
    if err is not None:
        return err

    save = shim.env.save_value
    if save is None:
        return web.json_response({"error": "env_unavailable"}, status=503)
    try:
        with profile_home_override(profile):
            save(name, value)
    except ValueError as exc:
        # Invalid name / denylisted var (PATH, LD_PRELOAD, …).
        return web.json_response({"error": "invalid", "detail": str(exc)}, status=400)
    except Exception:
        logger.exception("[hms.models] set_key %s failed", name)
        return web.json_response({"error": "write_failed"}, status=500)
    return web.json_response({"ok": True, "name": name})


@router.delete("/api/models/keys")
async def delete_key(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json_required"}, status=400)

    name = (body.get("name") or "").strip()
    if not name:
        return web.json_response({"error": "name_required"}, status=400)

    profile, err = profile_arg(request)
    if err is not None:
        return err

    remove = shim.env.remove_value
    if remove is None:
        return web.json_response({"error": "env_unavailable"}, status=503)
    try:
        with profile_home_override(profile):
            found = remove(name)
    except Exception:
        logger.exception("[hms.models] delete_key %s failed", name)
        return web.json_response({"error": "write_failed"}, status=500)
    if not found:
        return web.json_response({"error": "key_not_found"}, status=404)
    return web.json_response({"ok": True, "name": name})


@router.get("/api/models/auxiliary")
async def get_auxiliary(request: web.Request) -> web.Response:
    """Per-task auxiliary slots + the main assignment, read in-process.

    Replicates the dashboard's ``GET /api/model/auxiliary`` (a pure
    ``config.yaml`` read) so a ``?profile=`` scope resolves the selected
    profile's home via ``profile_home_override`` — the dashboard loopback
    couldn't see that override.
    """
    profile, err = profile_arg(request)
    if err is not None:
        return err

    loader = shim.models.load_config
    if loader is None:
        return web.json_response({"tasks": [], "main": {}, "error": "env_unavailable"})
    try:
        with profile_home_override(profile):
            cfg = dict(loader() or {})
    except Exception:
        logger.exception("[hms.models] auxiliary load_config failed")
        return web.json_response({"tasks": [], "main": {}, "error": "config_error"})

    aux_cfg = cfg.get("auxiliary") if isinstance(cfg.get("auxiliary"), dict) else {}
    aux_cfg = aux_cfg or {}
    tasks = []
    for slot in AUX_TASK_SLOTS:
        slot_cfg = aux_cfg.get(slot) if isinstance(aux_cfg.get(slot), dict) else {}
        slot_cfg = slot_cfg or {}
        tasks.append({
            "task": slot,
            "provider": str(slot_cfg.get("provider", "auto") or "auto"),
            "model": str(slot_cfg.get("model", "") or ""),
            "base_url": str(slot_cfg.get("base_url", "") or ""),
        })

    model_cfg = cfg.get("model", {})
    if isinstance(model_cfg, dict):
        main = {
            "provider": str(model_cfg.get("provider", "") or ""),
            "model": str(model_cfg.get("default", model_cfg.get("name", "")) or ""),
        }
    else:
        main = {"provider": "", "model": str(model_cfg) if model_cfg else ""}

    return web.json_response({"tasks": tasks, "main": main})


def _apply_nous_main_defaults(cfg: dict, provider: str) -> list[str]:
    """Mirror the CLI's nous tool-gateway auto-routing on a nous main switch.

    Additive only (``apply_nous_managed_defaults`` skips every tool the user
    already has a key/backend for); best-effort — a portal hiccup or
    non-subscriber must never block saving the assignment.
    """
    if provider.strip().lower() != "nous":
        return []
    apply_defaults = shim.models.nous_apply_defaults
    get_platform_tools = shim.toolsets.get_platform_tools
    if apply_defaults is None or get_platform_tools is None:
        return []
    try:
        enabled = get_platform_tools(cfg, "cli", include_default_mcp_servers=False)
        changed = apply_defaults(cfg, enabled_toolsets=enabled, force_fresh=True)
        return sorted(changed or [])
    except Exception:
        logger.debug("[hms.models] nous managed defaults skipped", exc_info=True)
        return []


def _stale_auxiliary(cfg: dict, new_provider: str) -> list[dict]:
    """Aux slots still pinned to a provider other than the new main one.

    A UI nudge (we never auto-clear pins — a different aux provider is a valid
    config) so the user can reset them instead of paying 402s on a now-unpaid
    background provider.
    """
    new_p = new_provider.strip().lower()
    out: list[dict] = []
    aux = cfg.get("auxiliary")
    if not isinstance(aux, dict):
        return out
    for slot in AUX_TASK_SLOTS:
        sc = aux.get(slot)
        if not isinstance(sc, dict):
            continue
        sp = str(sc.get("provider", "") or "").strip()
        if sp and sp.lower() not in {"auto", ""} and sp.lower() != new_p:
            out.append({"task": slot, "provider": sp, "model": str(sc.get("model", "") or "")})
    return out


@router.post("/api/models/assign")
async def assign_model(request: web.Request) -> web.Response:
    """task='' with scope=auxiliary applies to all 9 slots.

    task='__reset__' resets to provider=auto.
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json_required"}, status=400)

    scope = (body.get("scope") or "").strip().lower()
    if scope not in ("main", "auxiliary"):
        return web.json_response({"error": "scope_invalid"}, status=400)

    provider = (body.get("provider") or "").strip()
    model = (body.get("model") or "").strip()
    task = (body.get("task") or "").strip().lower()
    base_url = (body.get("base_url") or "").strip()

    profile, err = profile_arg(request)
    if err is not None:
        return err

    # Upstream-parity validation up front, so bad input is a clean 400 (not a
    # 500 from inside the worker thread).
    if scope == "main" and (not provider or not model):
        return web.json_response({"error": "provider_model_required"}, status=400)
    if scope == "auxiliary" and task != "__reset__":
        if not provider:
            return web.json_response({"error": "provider_required"}, status=400)
        if task and task not in AUX_TASK_SLOTS:
            return web.json_response({"error": "unknown_task", "task": task}, status=400)

    load_cfg = shim.models.load_config_mut
    save_cfg = shim.models.save_config
    apply_main = shim.models.apply_main
    if load_cfg is None or save_cfg is None or apply_main is None:
        return web.json_response({"error": "env_unavailable"}, status=503)

    def _apply() -> dict:
        raw_cfg: Any = load_cfg() or {}
        cfg: dict[str, Any] = raw_cfg if isinstance(raw_cfg, dict) else {}
        if scope == "main":
            cfg["model"] = apply_main(cfg.get("model", {}), provider, model, base_url)
            gateway_tools = _apply_nous_main_defaults(cfg, provider)
            save_cfg(cfg)
            model_cfg: Any = cfg.get("model", {})
            return {
                "ok": True, "scope": "main", "provider": provider, "model": model,
                "base_url": model_cfg.get("base_url", "") if isinstance(model_cfg, dict) else "",
                "gateway_tools": gateway_tools,
                "stale_aux": _stale_auxiliary(cfg, provider),
            }
        # scope == "auxiliary"
        aux_raw: Any = cfg.get("auxiliary")
        aux: dict[str, Any] = aux_raw if isinstance(aux_raw, dict) else {}
        if task == "__reset__":
            for slot in AUX_TASK_SLOTS:
                sc_raw: Any = aux.get(slot)
                sc: dict[str, Any] = sc_raw if isinstance(sc_raw, dict) else {}
                sc["provider"], sc["model"] = "auto", ""
                aux[slot] = sc
            cfg["auxiliary"] = aux
            save_cfg(cfg)
            return {"ok": True, "scope": "auxiliary", "reset": True}
        targets = [task] if task else list(AUX_TASK_SLOTS)
        for slot in targets:
            tsc_raw: Any = aux.get(slot)
            tsc: dict[str, Any] = tsc_raw if isinstance(tsc_raw, dict) else {}
            tsc["provider"], tsc["model"] = provider, model
            aux[slot] = tsc
        cfg["auxiliary"] = aux
        save_cfg(cfg)
        return {"ok": True, "scope": "auxiliary", "tasks": targets,
                "provider": provider, "model": model}

    try:
        with profile_home_override(profile):
            result = await asyncio.to_thread(_apply)
        # Reload the LIVE config only for the active/default home — a named
        # profile's write lands on its own on-disk config.yaml (applied when it
        # runs); reloading under its override would pollute the live process.
        if profile is None:
            await asyncio.to_thread(config_reader.reload)
    except Exception:
        logger.exception("[hms.models] assign failed (scope=%s)", scope)
        return web.json_response({"error": "write_failed"}, status=500)
    return web.json_response(result)


def _clean_fallback_chain(raw: Any) -> list[dict]:
    """Normalize a posted chain to ordered ``{provider, model, base_url?}`` entries."""
    out: list[dict] = []
    if not isinstance(raw, list):
        return out
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        provider = str(entry.get("provider") or "").strip()
        model = str(entry.get("model") or "").strip()
        if not provider or not model:
            continue
        clean: dict = {"provider": provider, "model": model}
        base_url = str(entry.get("base_url") or "").strip()
        if base_url:
            clean["base_url"] = base_url
        out.append(clean)
    return out


@router.get("/api/models/fallback")
async def get_fallback(request: web.Request) -> web.Response:
    """The effective fallback chain (main-model failure → try these in order)."""
    profile, err = profile_arg(request)
    if err is not None:
        return err
    loader = shim.models.load_config
    chain_fn = shim.models.fallback_chain
    if loader is None or chain_fn is None:
        return web.json_response({"chain": [], "error": "env_unavailable"})
    try:
        with profile_home_override(profile):
            cfg = dict(loader() or {})
        chain = chain_fn(cfg) or []
    except Exception:
        logger.exception("[hms.models] fallback read failed")
        return web.json_response({"chain": [], "error": "config_error"})
    return web.json_response({"chain": _clean_fallback_chain(chain)})


@router.put("/api/models/fallback")
async def set_fallback(request: web.Request) -> web.Response:
    """Write the fallback chain to ``fallback_providers`` (the modern key).

    Also drops any legacy ``fallback_model`` so the editor is authoritative —
    otherwise ``get_fallback_chain`` would append the legacy entry back into the
    effective chain.
    """
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "json_required"}, status=400)

    profile, err = profile_arg(request)
    if err is not None:
        return err
    if not isinstance(body.get("chain"), list):
        return web.json_response({"error": "chain_required"}, status=400)
    chain = _clean_fallback_chain(body.get("chain"))

    load_cfg = shim.models.load_config_mut
    save_cfg = shim.models.save_config
    if load_cfg is None or save_cfg is None:
        return web.json_response({"error": "env_unavailable"}, status=503)

    def _apply() -> None:
        raw_cfg: Any = load_cfg() or {}
        cfg: dict[str, Any] = raw_cfg if isinstance(raw_cfg, dict) else {}
        cfg["fallback_providers"] = chain
        cfg.pop("fallback_model", None)
        save_cfg(cfg)

    try:
        with profile_home_override(profile):
            await asyncio.to_thread(_apply)
        if profile is None:
            await asyncio.to_thread(config_reader.reload)
    except Exception:
        logger.exception("[hms.models] fallback write failed")
        return web.json_response({"error": "write_failed"}, status=500)
    return web.json_response({"ok": True, "chain": chain})


@router.post("/api/models/test/{provider}")
async def test_provider(request: web.Request) -> web.Response:
    """Read-only health check — no completion call."""
    provider = request.match_info["provider"]
    fn = shim.models.list_authenticated_providers
    if fn is None:
        return web.json_response({
            "ok": False,
            "provider": provider,
            "reason": "upstream_unavailable",
        })

    loop = asyncio.get_running_loop()
    try:
        providers = await loop.run_in_executor(None, fn)
    except Exception as exc:
        logger.warning("[hms.models] test %s failed: %s", provider, exc)
        return web.json_response({
            "ok": False,
            "provider": provider,
            "reason": str(exc),
        })

    for p in providers or []:
        slug = getattr(p, "slug", None) or (p.get("slug") if isinstance(p, dict) else None)
        if slug == provider:
            models = getattr(p, "models", None) or (p.get("models") if isinstance(p, dict) else [])
            return web.json_response({
                "ok": True,
                "provider": provider,
                "models_count": len(models) if models else 0,
            })

    return web.json_response({
        "ok": False,
        "provider": provider,
        "reason": "provider_not_found",
    })


def attach(app: web.Application) -> None:
    app.add_routes(router)


def reset_rate_limits_for_test() -> None:
    _reveal_log.clear()


AUX_TASK_SLOTS: tuple[str, ...] = (
    "vision",
    "web_extract",
    "compression",
    "session_search",
    "skills_hub",
    "approval",
    "mcp",
    "title_generation",
    "curator",
)


__all__ = ["attach", "reset_rate_limits_for_test", "AUX_TASK_SLOTS"]
