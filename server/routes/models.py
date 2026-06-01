"""Model capability + key + assignment endpoints — writes proxy to Dashboard."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import defaultdict
from typing import Any

from aiohttp import ClientSession, ClientTimeout, web

from server.lib import config_reader
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


async def _dashboard_request(
    method: str,
    path: str,
    * ,
    json_body: dict | None = None,
    timeout_s: float = 5.0,
) -> tuple[int, Any] | None:
    """Returns (status, body) or None when upstream is unreachable."""
    base = config_reader.dashboard_url().rstrip("/")
    url = f"{base}{path}"

    from server.routes.dashboard_proxy import _resolve_token

    try:
        token = await _resolve_token(base)
        headers: dict[str, str] = {}
        if token:
            headers["X-Hermes-Session-Token"] = token
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        async with ClientSession(timeout=ClientTimeout(total=timeout_s)) as cs:
            async with cs.request(
                method,
                url,
                headers=headers,
                json=json_body,
            ) as resp:
                try:
                    body = await resp.json()
                except Exception:
                    body = {"raw": await resp.text()}
                return resp.status, body
    except Exception:
        logger.debug("[hms.models] dashboard %s %s failed", method, path, exc_info=True)
        return None


async def _fetch_dashboard_env() -> dict[str, dict] | None:
    """Returns the rich per-key metadata dict from upstream /api/env; None when unreachable."""
    result = await _dashboard_request("GET", "/api/env")
    if result is None:
        return None
    status, body = result
    if status != 200 or not isinstance(body, dict):
        return None
    # Reject the {raw: ...} fallback shape — caller treats None as unavailable.
    if set(body.keys()) == {"raw"}:
        return None
    return body


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
    env = await _fetch_dashboard_env()
    if env is None:
        return web.json_response({"keys": [], "error": "dashboard_unavailable"})

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

    # Upstream's reveal is rate-limited + audit-logged.
    result = await _dashboard_request("POST", "/api/env/reveal", json_body={"key": name})
    if result is None:
        return web.json_response({"error": "dashboard_unavailable"}, status=503)
    status, body = result
    if status == 404:
        return web.json_response({"error": "key_not_found"}, status=404)
    if status == 429:
        return web.json_response({"error": "rate_limited"}, status=429)
    if status != 200 or not isinstance(body, dict):
        return web.json_response({"error": "upstream_error", "status": status}, status=502)
    value = body.get("value")
    if value is None:
        return web.json_response({"error": "no_value"}, status=502)
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

    result = await _dashboard_request(
        "PUT", "/api/env", json_body={"key": name, "value": value}
    )
    if result is None:
        return web.json_response({"error": "dashboard_unavailable"}, status=503)
    status, resp_body = result
    if status != 200:
        return web.json_response(
            {"error": "upstream_error", "status": status, "detail": resp_body},
            status=status if 400 <= status < 600 else 502,
        )
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

    result = await _dashboard_request(
        "DELETE", "/api/env", json_body={"key": name}
    )
    if result is None:
        return web.json_response({"error": "dashboard_unavailable"}, status=503)
    status, resp_body = result
    if status == 404:
        return web.json_response({"error": "key_not_found"}, status=404)
    if status != 200:
        return web.json_response(
            {"error": "upstream_error", "status": status, "detail": resp_body},
            status=status if 400 <= status < 600 else 502,
        )
    return web.json_response({"ok": True, "name": name})


@router.get("/api/models/auxiliary")
async def get_auxiliary(request: web.Request) -> web.Response:
    result = await _dashboard_request("GET", "/api/model/auxiliary")
    if result is None:
        return web.json_response(
            {"tasks": [], "main": {}, "error": "dashboard_unavailable"},
        )
    status, body = result
    if status != 200 or not isinstance(body, dict):
        return web.json_response(
            {"tasks": [], "main": {}, "error": "upstream_error", "status": status},
        )
    return web.json_response(body)


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

    result = await _dashboard_request(
        "POST", "/api/model/set",
        json_body={
            "scope": scope,
            "provider": body.get("provider", ""),
            "model": body.get("model", ""),
            "task": body.get("task", ""),
        },
        timeout_s=10.0,
    )
    if result is None:
        return web.json_response({"error": "dashboard_unavailable"}, status=503)
    status, resp_body = result
    if status != 200:
        return web.json_response(
            {"error": "upstream_error", "status": status, "detail": resp_body},
            status=status if 400 <= status < 600 else 502,
        )
    return web.json_response(resp_body)


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
