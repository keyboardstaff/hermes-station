"""CRUD for ~/.hermes/station/projects.json — station-private session grouping."""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
from pathlib import Path
from typing import Any, TypeGuard

from aiohttp import web

from server.lib.upstream_paths import hms_data_dir

router = web.RouteTableDef()


def _projects_path() -> Path:
    return hms_data_dir() / "projects.json"


_ID_RE = re.compile(r"^[a-f0-9]{12}$")
_COLOR_RE = re.compile(r"^[#\w()\-,.\s/%]{2,40}$")
_NAME_MAX = 80


_lock = asyncio.Lock()


def _read_sync() -> list[dict[str, Any]]:
    path = _projects_path()
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out: list[dict[str, Any]] = []
    for item in data:
        if (
            isinstance(item, dict)
            and isinstance(item.get("id"), str)
            and isinstance(item.get("name"), str)
            and isinstance(item.get("color"), str)
        ):
            out.append({"id": item["id"], "name": item["name"], "color": item["color"]})
    return out


def _write_sync(items: list[dict[str, Any]]) -> None:
    path = _projects_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp.{os.getpid()}")
    tmp.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


async def _read() -> list[dict[str, Any]]:
    return await asyncio.get_running_loop().run_in_executor(None, _read_sync)


async def _write(items: list[dict[str, Any]]) -> None:
    await asyncio.get_running_loop().run_in_executor(None, _write_sync, items)


def _valid_name(v: Any) -> TypeGuard[str]:
    return isinstance(v, str) and 1 <= len(v.strip()) <= _NAME_MAX


def _valid_color(v: Any) -> TypeGuard[str]:
    return isinstance(v, str) and bool(_COLOR_RE.match(v.strip()))


@router.get("/api/projects")
async def list_projects(request: web.Request) -> web.Response:
    return web.json_response({"projects": await _read()})


@router.post("/api/projects")
async def create_project(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)
    name = body.get("name")
    color = body.get("color")
    if not _valid_name(name):
        return web.json_response({"error": "invalid_name"}, status=400)
    if not _valid_color(color):
        return web.json_response({"error": "invalid_color"}, status=400)

    async with _lock:
        items = await _read()
        new = {
            "id": secrets.token_hex(6),
            "name": name.strip(),
            "color": color.strip(),
        }
        items.append(new)
        await _write(items)
    return web.json_response(new, status=201)


@router.put("/api/projects/{project_id}")
async def update_project(request: web.Request) -> web.Response:
    pid = request.match_info["project_id"]
    if not _ID_RE.match(pid):
        return web.json_response({"error": "invalid_id"}, status=400)
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)

    async with _lock:
        items = await _read()
        idx = next((i for i, p in enumerate(items) if p["id"] == pid), -1)
        if idx < 0:
            return web.json_response({"error": "not_found"}, status=404)
        if "name" in body:
            if not _valid_name(body["name"]):
                return web.json_response({"error": "invalid_name"}, status=400)
            items[idx]["name"] = body["name"].strip()
        if "color" in body:
            if not _valid_color(body["color"]):
                return web.json_response({"error": "invalid_color"}, status=400)
            items[idx]["color"] = body["color"].strip()
        updated = dict(items[idx])
        await _write(items)
    return web.json_response(updated)


@router.delete("/api/projects/{project_id}")
async def delete_project(request: web.Request) -> web.Response:
    pid = request.match_info["project_id"]
    if not _ID_RE.match(pid):
        return web.json_response({"error": "invalid_id"}, status=400)
    async with _lock:
        items = await _read()
        kept = [p for p in items if p["id"] != pid]
        if len(kept) == len(items):
            return web.json_response({"error": "not_found"}, status=404)
        await _write(kept)
    return web.json_response({"ok": True})


def attach(app: web.Application) -> None:
    app.router.add_routes(router)


__all__ = ["attach"]
