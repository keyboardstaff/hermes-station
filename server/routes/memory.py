"""Structured-memory data sovereignty — view + delete what the agent has
remembered. Backed by the holographic provider's local ``memory_store.db``
(``list_facts`` / ``remove_fact``). Other memory providers (honcho, mem0,
supermemory, …) are remote services managed outside Station, so the route
reports ``available: false`` when holographic isn't installed.

Profile-scoped: reads the *active* profile's ``memory_store.db``. CSRF on the
mutating verb is enforced by the global middleware; all upstream access goes
through the shim.
"""

from __future__ import annotations

import asyncio
import logging

from aiohttp import web

from server.lib.profile_run import resolve_profile_home
from server.lib.upstream_paths import memory_store_path
from server.lib.upstream_shim import shim

logger = logging.getLogger(__name__)

router = web.RouteTableDef()

# Whitelist the columns we surface (drop hrr_vector BLOB etc.).
_FACT_FIELDS = (
    "fact_id", "content", "category", "tags", "trust_score",
    "retrieval_count", "helpful_count", "created_at", "updated_at",
)


def _list_facts(store_cls: type, path: str) -> list[dict]:
    with store_cls(db_path=path) as store:
        rows = store.list_facts(limit=500)
    return [{k: r.get(k) for k in _FACT_FIELDS} for r in rows]


def _remove_fact(store_cls: type, path: str, fact_id: int) -> bool:
    with store_cls(db_path=path) as store:
        return bool(store.remove_fact(fact_id))


@router.get("/api/memory")
async def list_memory(request: web.Request) -> web.Response:
    store_cls = shim.memory.MemoryStore
    if store_cls is None:
        return web.json_response({"available": False, "facts": []})
    # ``?profile=<name>`` scopes to a specific profile's store (the Profile panel
    # inspects any profile); absent / "default" → the process home.
    path = memory_store_path(resolve_profile_home(request.query.get("profile")))
    if not path.exists():
        # Holographic is present but nothing's been remembered yet — do NOT
        # open the store (that would create an empty db side-effect).
        return web.json_response({"available": True, "facts": []})
    try:
        facts = await asyncio.get_running_loop().run_in_executor(
            None, _list_facts, store_cls, str(path),
        )
    except Exception:
        logger.exception("[hms.memory] list_facts failed")
        return web.json_response({"error": "memory_read_failed"}, status=500)
    return web.json_response({"available": True, "facts": facts})


@router.delete("/api/memory/{fact_id}")
async def delete_memory(request: web.Request) -> web.Response:
    store_cls = shim.memory.MemoryStore
    if store_cls is None:
        return web.json_response({"error": "unavailable"}, status=409)
    try:
        fact_id = int(request.match_info["fact_id"])
    except ValueError:
        return web.json_response({"error": "invalid_fact_id"}, status=400)
    path = memory_store_path(resolve_profile_home(request.query.get("profile")))
    if not path.exists():
        return web.json_response({"removed": False})
    try:
        removed = await asyncio.get_running_loop().run_in_executor(
            None, _remove_fact, store_cls, str(path), fact_id,
        )
    except Exception:
        logger.exception("[hms.memory] remove_fact failed")
        return web.json_response({"error": "memory_delete_failed"}, status=500)
    return web.json_response({"removed": removed})


def attach(app: web.Application) -> None:
    app.router.add_routes(router)
