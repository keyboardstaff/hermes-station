"""aiohttp.web.Application factory."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from server.adapter import StationAdapter

logger = logging.getLogger(__name__)


def build_app(*, adapter: StationAdapter | None = None):
    from aiohttp import web

    from server.app_keys import ADAPTER_KEY
    from server.auth import auth_middleware
    from server.csrf import csrf_middleware
    from server.lib import config_reader
    from server.middleware.cors import cors_middleware
    from server.middleware.host_guard import host_guard_middleware
    from server.middleware.rate_limit import rate_limit
    from server.middleware.security_headers import security_headers_middleware

    app = web.Application(
        middlewares=[
            host_guard_middleware,
            cors_middleware,
            rate_limit(
                limit=config_reader.rate_limit_per_minute(),
                loopback_limit=config_reader.rate_limit_loopback_per_minute(),
                window_seconds=60.0,
            ),
            security_headers_middleware,
            auth_middleware,
            csrf_middleware,
        ],
        client_max_size=config_reader.max_upload_bytes(),
    )
    app[ADAPTER_KEY] = adapter

    from server.routes import (
        allowlist,
        analytics,
        approvals,
        chat,
        dashboard_proxy,
        files,
        kanban,
        login,
        logs,
        mcp,
        memory,
        onboarding,
        password,
        plugins,
        preferences,
        projects,
        skills_content,
        upload,
    )

    # Aliased imports — these route modules share names with top-level
    # ``server.*`` modules (server.runs / server.lifecycle / etc), so we
    # alias to ``_route`` to keep both reachable in this file.
    from server.routes import config as config_route
    from server.routes import lifecycle as lifecycle_route
    from server.routes import models as models_route
    from server.routes import profiles as profiles_route
    from server.routes import runs as runs_route
    from server.routes import settings as settings_route
    from server.routes import ws as ws_route

    login.attach(app)
    chat.attach(app)
    projects.attach(app)
    runs_route.attach(app)
    approvals.attach(app)
    allowlist.attach(app)
    settings_route.attach(app)
    password.attach(app)
    onboarding.attach(app)
    profiles_route.attach(app)
    config_route.attach(app)
    logs.attach(app)
    dashboard_proxy.attach(app)
    plugins.attach(app)
    memory.attach(app)
    preferences.attach(app)
    upload.attach(app)
    models_route.attach(app)
    analytics.attach(app)
    kanban.attach(app)
    files.attach(app)
    lifecycle_route.attach(app)
    ws_route.attach(app)
    skills_content.attach(app)
    mcp.attach(app)

    app.router.add_get("/api/capabilities", _handle_capabilities)
    app.router.add_post("/api/reprobe", _handle_reprobe)

    _attach_spa(app)

    app.on_startup.append(_on_startup)
    app.on_cleanup.append(_on_cleanup)

    # Register Station in the gateway's platform_registry so the LLM system-prompt
    # builder appends the Station-specific platform hint for every run.
    # Best-effort: called in both dev (build_app(adapter=None)) and production.
    _register_station_platform_hint()

    return app


def _attach_spa(app) -> None:
    """Serve the built SPA bundle from dist/ for browser hits.

    Skipped when dist/ is absent (dev mode — Vite serves the SPA).
    """
    from aiohttp import web

    from server.lib.config_reader import spa_dist_dir

    dist = spa_dist_dir()
    if dist is None:
        logger.info(
            "[hms.app] SPA dist/ not found — skipping static routes "
            "(dev mode — Vite serves the SPA)"
        )
        return

    index_path = dist / "index.html"
    dist_resolved = dist.resolve()

    def _is_spa_path(path: str) -> bool:
        return not (
            path.startswith("/api/")
            or path == "/ws"
            or path.startswith("/ws/")
        )

    async def _serve_index(_request: web.Request) -> web.StreamResponse:
        # FileResponse is a StreamResponse, not a (buffered) Response.
        return web.FileResponse(index_path)

    @web.middleware
    async def spa_middleware(
        request: web.Request, handler
    ) -> web.StreamResponse:
        if not _is_spa_path(request.path) or request.method not in ("GET", "HEAD"):
            return await handler(request)
        # aiohttp may signal no-match by raising HTTPNotFound or returning 404 — handle both.
        response: web.StreamResponse | None = None
        try:
            response = await handler(request)
        except web.HTTPNotFound:
            response = None
        if response is not None and response.status != 404:
            return response
        rel = request.path.lstrip("/")
        if rel:
            candidate = (dist / rel).resolve()
            try:
                candidate.relative_to(dist_resolved)
            except ValueError:
                raise web.HTTPNotFound() from None
            if candidate.is_file():
                return web.FileResponse(candidate)
        return web.FileResponse(index_path)

    app.middlewares.append(spa_middleware)
    app.router.add_get("/", _serve_index)
    logger.info("[hms.app] SPA dist/ mounted from %s", dist)


async def _on_startup(app) -> None:
    import asyncio

    from server import capabilities
    from server.app_keys import (
        CAPABILITY_TASK_KEY,
        DASHBOARD_SUPERVISOR_KEY,
        DASHBOARD_WATCHDOG_TASK_KEY,
        DISCOVERY_TASK_KEY,
        UPLOAD_GC_TASK_KEY,
    )
    from server.lib import config_reader
    from server.lib.dashboard_supervisor import DashboardSupervisor
    from server.lib.upstream_shim import shim
    from server.ws import get_ws_manager

    # Bind loop eagerly so broadcast_threadsafe never drops events fired
    # before the first /ws handler.
    get_ws_manager().bind_loop(asyncio.get_running_loop())

    try:
        shim.probe()
    except Exception:
        logger.exception("[hms.app] upstream shim probe failed (degraded mode)")

    # Align the agent's working dir (TERMINAL_CWD) with the active workspace.
    try:
        from server.lib.workspace_cwd import apply_active_workspace_cwd
        apply_active_workspace_cwd()
    except Exception:
        logger.exception("[hms.app] apply_active_workspace_cwd failed")

    # Bound disk: drop crash-recovery sidecars older than a week (one not viewed
    # by then is unlikely to matter). Surviving recent ones are surfaced on load.
    try:
        from server.lib import run_snapshot
        run_snapshot.sweep(7 * 24 * 3600)
    except Exception:
        logger.debug("[hms.app] run-snapshot sweep failed", exc_info=True)

    app[CAPABILITY_TASK_KEY] = asyncio.create_task(capabilities.refresh_loop())

    from server.routes.plugins import _watcher_loop as _discover_watcher
    app[DISCOVERY_TASK_KEY] = asyncio.create_task(_discover_watcher())

    from server.routes.upload import _gc_loop as _upload_gc
    app[UPLOAD_GC_TASK_KEY] = asyncio.create_task(_upload_gc())

    if config_reader.dashboard_autostart():
        supervisor = DashboardSupervisor()
        app[DASHBOARD_SUPERVISOR_KEY] = supervisor
        try:
            await supervisor.ensure_running()
        except Exception:
            logger.exception("[hms.app] dashboard ensure_running failed")
        app[DASHBOARD_WATCHDOG_TASK_KEY] = asyncio.create_task(supervisor.watchdog())
    else:
        logger.info("[hms.app] dashboard.autostart is disabled — skipping supervisor")

    if config_reader.gateway_autostart():
        try:
            await asyncio.to_thread(_start_gateway_if_idle)
        except Exception:
            logger.exception("[hms.app] gateway auto-activate failed")


def _start_gateway_if_idle() -> None:
    from server import lifecycle

    snap = lifecycle.get_gateway_status()
    if snap.get("service_installed") and not snap.get("service_running"):
        result = lifecycle.start_gateway()
        if not result.get("ok"):
            logger.warning("[hms.app] gateway start returned: %s", result)


async def _on_cleanup(app) -> None:
    """Cancel background tasks then terminate the dashboard.

    The watchdog must die before the supervisor or it will respawn.
    """
    from server.app_keys import ALL_TASK_KEYS, DASHBOARD_SUPERVISOR_KEY

    for key in ALL_TASK_KEYS:
        task = app.get(key)
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except BaseException:
                pass

    supervisor = app.get(DASHBOARD_SUPERVISOR_KEY)
    if supervisor is not None:
        try:
            await supervisor.terminate()
        except Exception:
            logger.exception("[hms.app] dashboard terminate failed")


async def _handle_capabilities(request):
    from aiohttp import web

    from server import capabilities
    cached = capabilities.get_cached()
    if cached is None:
        cached = await capabilities.probe()
    return web.json_response({
        **cached,
        "flags": _shim_flags_payload(),
        "limits": _limits_payload(),
    })


async def _handle_reprobe(request):
    from aiohttp import web

    from server import capabilities
    from server.lib.upstream_shim import shim
    shim.probe(force=True)
    return web.json_response({
        **(await capabilities.probe()),
        "flags": _shim_flags_payload(),
        "limits": _limits_payload(),
    })


def _limits_payload() -> dict:
    from server.lib import config_reader
    return {
        "max_upload_bytes": config_reader.max_upload_bytes(),
        "max_concurrent_runs": config_reader.max_concurrent_runs(),
        "upload_retention_days": config_reader.upload_retention_days(),
    }


def _shim_flags_payload() -> dict:
    from server.lib.upstream_shim import shim
    if not shim._probed:  # type: ignore[attr-defined]
        shim.probe()
    return shim.to_dict()


# ---------------------------------------------------------------------------
# Platform hint registration
# ---------------------------------------------------------------------------

# Injected into the LLM system-prompt by upstream's build_stable_parts() when
# it finds platform_registry.get("station").platform_hint.  Tells the model
# what markdown / math / diagram rendering is available in Station.
_STATION_PLATFORM_HINT = (
    "You are in Hermes Station, a web chat interface. "
    "Markdown renders natively: headings, bold, tables, code blocks with "
    "syntax highlighting, task lists. "
    "Math: $...$ (inline) and $$...$$ (display) render with KaTeX. "
    "Diagrams: ```mermaid blocks render as interactive diagrams. "
    "Files: no attachment channel — use absolute paths; "
    "the user opens them in the file browser."
)


def _register_station_platform_hint() -> None:
    """Inject the Station platform hint into the LLM system prompt.

    Two parallel paths — whichever succeeds first wins:
    1. platform_registry (the "proper" plugin extension point in newer
       upstream versions): upstream's build_stable_parts() checks
       platform_registry.get("station").platform_hint.
    2. PLATFORM_HINTS dict (direct injection, works on older upstream):
       build_stable_parts() checks PLATFORM_HINTS["station"] first, before
       the registry lookup.

    Called from build_app() so it fires in both dev and production modes.
    """
    hint_injected = False

    # ── Path 1: platform_registry ─────────────────────────────────────────
    try:
        from server.lib.upstream_shim import shim
        registry = shim.gateway.platform_registry
        PlatformEntry = shim.gateway.PlatformEntry  # noqa: N806
        if registry is not None and PlatformEntry is not None:
            if registry.get("station") is None:
                registry.register(
                    PlatformEntry(
                        name="station",
                        label="Station",
                        emoji="🌐",
                        adapter_factory=lambda cfg: None,
                        check_fn=lambda: True,
                        platform_hint=_STATION_PLATFORM_HINT,
                        source="plugin",
                    )
                )
            hint_injected = True
    except Exception:
        logger.debug("[hms.app] platform_registry path failed", exc_info=True)

    # ── Path 2: PLATFORM_HINTS dict (fallback) ────────────────────────────
    # Works on upstream versions that have PLATFORM_HINTS but not a plugin
    # platform_registry, or when platform_registry import fails.
    if not hint_injected:
        try:
            from agent.prompt_builder import PLATFORM_HINTS  # hms-allow-hardcoding
            if "station" not in PLATFORM_HINTS:
                PLATFORM_HINTS["station"] = _STATION_PLATFORM_HINT
            hint_injected = True
        except Exception:
            logger.debug("[hms.app] PLATFORM_HINTS fallback failed", exc_info=True)

    if hint_injected:
        logger.info("[hms.app] station platform hint injected — LLM will see Station context")
    else:
        logger.warning(
            "[hms.app] could not inject station platform hint "
            "(both platform_registry and PLATFORM_HINTS paths failed)"
        )
