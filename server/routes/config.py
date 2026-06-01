"""Config + Models read-only endpoints for Composer dropdowns."""

from __future__ import annotations

import asyncio
import logging
import os
import time

import aiohttp as _aiohttp
from aiohttp import web

from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)

router = web.RouteTableDef()


# Keyed by config (mtime, size) so out-of-band edits show up next call; TTL caps stale window.
_MODELS_CACHE_TTL_S = 120.0
_models_cache: dict | None = None
_models_cache_key: tuple = ()
_models_cache_at: float = 0.0


def _safe_load_config() -> dict:
    """Share config_reader's lru_cache so writes via /api/settings reload here too."""
    try:
        from server.lib import config_reader
        return dict(config_reader._cached_doc() or {})
    except Exception:
        logger.exception("[hms.config] _cached_doc failed")
        return {}


def _safe_personalities(cfg: dict) -> list[str]:
    raw = cfg.get("personalities") or {}
    if isinstance(raw, dict):
        return sorted(str(k) for k in raw.keys())
    if isinstance(raw, list):
        return [str(x) for x in raw if isinstance(x, (str, int))]
    return []


def _safe_model_default(cfg: dict) -> str | None:
    model_block = cfg.get("model")
    if isinstance(model_block, dict):
        v = model_block.get("default")
        return str(v) if v else None
    if isinstance(model_block, str):
        return model_block or None
    v = cfg.get("model_default")
    return str(v) if v else None


@router.get("/api/config")
async def get_config(request: web.Request) -> web.Response:
    cfg = _safe_load_config()
    return web.json_response({
        "model_default": _safe_model_default(cfg),
        "personalities": _safe_personalities(cfg),
    })


def _safe_model_field(cfg: dict, key: str) -> str:
    block = cfg.get("model")
    if isinstance(block, dict):
        v = block.get(key)
        return str(v).strip() if isinstance(v, (str, int)) else ""
    return ""


def _config_mtime_key() -> tuple:
    try:
        from server.lib.upstream_paths import hermes_home
        st = (hermes_home() / "config.yaml").stat()
        return (st.st_mtime_ns, st.st_size)
    except Exception:
        return ()


def _compute_models_payload() -> dict:
    """Synchronous payload build (runs in executor)."""
    cfg = _safe_load_config()
    default = _safe_model_default(cfg)
    current_provider = _safe_model_field(cfg, "provider")
    current_base_url = _safe_model_field(cfg, "base_url")
    current_model = (
        _safe_model_field(cfg, "default")
        or _safe_model_field(cfg, "name")
        or (default or "")
    )
    user_providers = cfg.get("providers") if isinstance(cfg.get("providers"), dict) else {}
    _custom = cfg.get("custom_providers")
    custom_providers = _custom if isinstance(_custom, list) else []

    providers: list[dict] = []
    # Prefer list_picker_providers (live-validated openrouter catalog) over the older curated list.
    _list_providers = (
        shim.models.list_picker_providers
        or shim.models.list_authenticated_providers
    )
    fn_name = (
        "list_picker_providers" if shim.models.list_picker_providers is not None
        else "list_authenticated_providers"
    )
    if _list_providers is None:
        logger.warning("[hms.models] upstream model listing functions unavailable")
        raw = []
    else:
        try:
            raw = _list_providers(
                current_provider=current_provider,
                current_base_url=current_base_url,
                user_providers=user_providers,
                custom_providers=custom_providers,
                max_models=50,
                current_model=current_model,
            ) or []
        except Exception:
            logger.exception("[hms.models] %s failed", fn_name)
            raw = []

    # Normalise: models[] must exist so the picker's .filter doesn't crash on undefined.
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        slug = entry.get("slug") or entry.get("name")
        if not slug:
            continue
        models_raw = entry.get("models")
        models = [m for m in models_raw if isinstance(m, str)] \
            if isinstance(models_raw, list) else []
        providers.append({
            "slug": str(slug),
            "name": str(entry.get("name") or slug),
            "models": models,
            "is_current": bool(entry.get("is_current")),
            "is_user_defined": bool(entry.get("is_user_defined")),
            "source": str(entry.get("source") or "built-in"),
            "total_models": int(entry.get("total_models") or len(models)),
        })

    return {
        "providers": providers,
        "model_default": default,
        "provider": current_provider,
        "model": current_model,
        # Back-compat: keep flat models[] for consumers that still read it,
        # even though the picker now iterates providers[].
        "models": [],
    }


@router.get("/api/models")
async def get_models(request: web.Request) -> web.Response:
    """Cached non-blocking variant; refresh=1 forces re-probe."""
    global _models_cache, _models_cache_key, _models_cache_at

    key = _config_mtime_key()
    now = time.monotonic()
    force = request.query.get("refresh") in ("1", "true", "yes")

    if (
        not force
        and _models_cache is not None
        and _models_cache_key == key
        and (now - _models_cache_at) < _MODELS_CACHE_TTL_S
    ):
        return web.json_response(_models_cache)

    loop = asyncio.get_running_loop()
    try:
        payload = await loop.run_in_executor(None, _compute_models_payload)
    except Exception:
        logger.exception("[hms.models] payload build failed")
        payload = {
            "providers": [], "model_default": None,
            "provider": "", "model": "", "models": [],
        }

    _models_cache = payload
    _models_cache_key = key
    _models_cache_at = now
    return web.json_response(payload)


_OR_CATALOG_TTL_S = 30.0
_or_catalog_cache: dict[tuple, tuple[float, list[str]]] = {}


@router.get("/api/models/openrouter-catalog")
async def openrouter_catalog(request: web.Request) -> web.Response:
    """OpenRouter models matching q, filtered to tools/function-calling support."""
    q = (request.query.get("q") or "").strip().lower()

    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        return web.json_response(
            {"error": "OPENROUTER_API_KEY not set"}, status=503
        )

    cache_key = (api_key[:16], q)
    now = time.monotonic()
    if cache_key in _or_catalog_cache:
        cached_at, cached_models = _or_catalog_cache[cache_key]
        if (now - cached_at) < _OR_CATALOG_TTL_S:
            return web.json_response(
                {"models": cached_models, "total": len(cached_models), "query": q}
            )

    url = "https://openrouter.ai/api/v1/models"
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with _aiohttp.ClientSession() as session:
            async with session.get(
                url, headers=headers, timeout=_aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.warning(
                        "[openrouter-catalog] API returned %s: %s", resp.status, body[:200]
                    )
                    return web.json_response(
                        {"error": "openrouter_api_error", "status": resp.status}, status=502
                    )
                data = await resp.json()
    except Exception:
        logger.exception("[openrouter-catalog] request failed")
        return web.json_response({"error": "request_failed"}, status=502)

    entries = data.get("data") or []
    model_ids: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        model_id: str = entry.get("id") or ""
        if not model_id:
            continue
        supported = entry.get("supported_parameters") or []
        if isinstance(supported, list) and "tools" not in supported:
            continue
        if q:
            name = (entry.get("name") or "").lower()
            if q not in model_id.lower() and q not in name:
                continue
        model_ids.append(model_id)

    _or_catalog_cache[cache_key] = (now, model_ids)
    return web.json_response({"models": model_ids, "total": len(model_ids), "query": q})


def attach(app: web.Application) -> None:
    app.add_routes(router)


__all__ = ["attach"]
