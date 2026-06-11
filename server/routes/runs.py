"""Run REST endpoints — start/stop/status; streaming events go over /ws (run:<id>)."""

from __future__ import annotations

import base64
import json
import logging
import mimetypes
import re
from pathlib import Path

from aiohttp import web

from server import runs
from server.lib.route_helpers import SESSION_ID_RE
from server.routes.upload import uploads_root
from server.ws import WSConnection
from server.ws_dispatch import register

logger = logging.getLogger(__name__)

# Mirrors hermes_cli.profiles validation (also in routes/profiles.py,
# routes/lifecycle.py) — keep in sync if upstream widens the charset.
_PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


@register("run.stop")
async def _ws_run_stop(conn: WSConnection, payload: dict) -> None:
    """WS-side ``run.stop`` — mirror of REST ``POST /api/runs/{id}/stop``.
    Acknowledged back to the same connection so the SPA's stop button
    can render a quick feedback even if the run has already exited."""
    run_id = payload.get("run_id")
    if not (isinstance(run_id, str) and run_id):
        return
    ok = await runs.stop_run(run_id)
    await conn.enqueue({"type": "run.stop.ack", "run_id": run_id, "ok": ok})

router = web.RouteTableDef()

_RUN_ID_RE = re.compile(r"^run_[a-f0-9]{32}$")
# /api/upload/<id>/<name> — local content-addressed uploads; resolved before passing to agent.
_UPLOAD_URL_RE = re.compile(r"^/api/upload/([^/]+)/([^/?#]+)$")
_UPLOAD_PART_RE = re.compile(r"^[A-Za-z0-9._\- ]{1,255}$")


async def _resolve_upload_images(input_data: str | list[dict]) -> str | list[dict]:
    """Inline local upload URLs (images→base64, text→markdown) — agent can't fetch our HTTP."""
    if not isinstance(input_data, list):
        return input_data

    root = uploads_root()
    result = []

    for item in input_data:
        if not isinstance(item, dict):
            result.append(item)
            continue

        if item.get("type") == "image_url" and isinstance(item.get("image_url"), dict):
            url = item["image_url"].get("url", "")
            m = _UPLOAD_URL_RE.match(url)
            if m:
                upload_id, name = m.group(1), m.group(2)
                if _UPLOAD_PART_RE.match(upload_id) and _UPLOAD_PART_RE.match(name):
                    candidate = root / upload_id / name
                    if candidate.is_file() and candidate.resolve().is_relative_to(root.resolve()):
                        raw = candidate.read_bytes()
                        mime = mimetypes.guess_type(name)[0] or "image/png"
                        b64 = base64.b64encode(raw).decode("ascii")
                        item["image_url"]["url"] = f"data:{mime};base64,{b64}"
            result.append(item)

        elif item.get("type") == "text":
            text = item.get("text", "")
            if not isinstance(text, str):
                result.append(item)
                continue
            item["text"] = _resolve_upload_urls_in_text(text, root)
            result.append(item)

        else:
            result.append(item)

    return result


def _resolve_upload_urls_in_text(text: str, root: Path) -> str:
    """Inline text-mime uploads as code blocks; leave binaries as URLs for tools to fetch."""
    parts: list[str] = []
    last_end = 0
    for m in _UPLOAD_URL_RE.finditer(text):
        upload_id, name = m.group(1), m.group(2)
        if not (_UPLOAD_PART_RE.match(upload_id) and _UPLOAD_PART_RE.match(name)):
            continue
        candidate = root / upload_id / name
        if not (candidate.is_file() and candidate.resolve().is_relative_to(root.resolve())):
            continue
        mime = mimetypes.guess_type(name)[0] or ""
        if not (mime.startswith("text/") or mime in {"application/json", "application/xml"}):
            continue
        parts.append(text[last_end:m.start()])
        try:
            content = candidate.read_text("utf-8", errors="replace")
            parts.append(f"```{name}\n{content}```")
        except Exception:
            logger.exception("[hms.runs] inline read failed for %s", candidate)
        last_end = m.end()
    parts.append(text[last_end:])
    return "".join(parts)


@router.post("/api/runs")
async def create_run(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "invalid_json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "body_must_be_object"}, status=400)

    raw_input = body.get("input")
    if isinstance(raw_input, str):
        input_data: str | list[dict] = raw_input
        input_text = raw_input
    elif isinstance(raw_input, list) and raw_input:
        # OpenAI multimodal — keep full list for image_url; extract text for validation.
        input_data = raw_input
        text_parts: list[str] = []
        for item in raw_input:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "image_url":
                continue
            part = item.get("text") or item.get("content", "")
            if isinstance(part, list):
                # Nested Claude-style content list.
                part = " ".join(
                    p.get("text", "")
                    for p in part
                    if isinstance(p, dict) and p.get("type") == "text"
                )
            if isinstance(part, str) and part:
                text_parts.append(part)
        input_text = " ".join(text_parts)
    else:
        return web.json_response({"error": "missing_input"}, status=400)

    has_images = isinstance(raw_input, list) and any(
        isinstance(p, dict) and p.get("type") == "image_url" for p in raw_input
    )
    if not input_text.strip() and not has_images:
        return web.json_response({"error": "empty_input"}, status=400)

    session_id = body.get("session_id")
    if session_id is not None:
        if not isinstance(session_id, str) or not SESSION_ID_RE.match(session_id):
            return web.json_response({"error": "invalid_session_id"}, status=400)

    model = body.get("model")
    reasoning_effort = body.get("reasoning_effort")
    provider = body.get("provider")
    profile = body.get("profile")
    if model is not None and not isinstance(model, str):
        return web.json_response({"error": "invalid_model"}, status=400)
    if reasoning_effort is not None and not isinstance(reasoning_effort, str):
        return web.json_response({"error": "invalid_reasoning_effort"}, status=400)
    if provider is not None and not isinstance(provider, str):
        return web.json_response({"error": "invalid_provider"}, status=400)
    if profile is not None and (not isinstance(profile, str) or not _PROFILE_ID_RE.match(profile)):
        return web.json_response({"error": "invalid_profile"}, status=400)

    history = body.get("conversation_history") or []
    if not isinstance(history, list):
        return web.json_response({"error": "invalid_history"}, status=400)

    # In-session regenerate / branch: truncate the transcript before the Nth
    # user turn, then re-run. Requires an existing session (there's nothing to
    # truncate in a brand-new one).
    truncate_ordinal = body.get("truncate_before_user_ordinal")
    if truncate_ordinal is not None:
        if (
            not isinstance(truncate_ordinal, int)
            or isinstance(truncate_ordinal, bool)
            or truncate_ordinal < 0
        ):
            return web.json_response({"error": "invalid_truncate_ordinal"}, status=400)
        if session_id is None:
            return web.json_response({"error": "truncate_requires_session"}, status=400)

    try:
        resolved_input = await _resolve_upload_images(input_data)
        # Slash commands route through upstream's GatewayRunner._handle_message
        # instead of the AIAgent — same path telegram / slack take. We only
        # intercept when text starts with "/" AND upstream registers the
        # command as gateway-dispatchable; everything else is plain chat.
        if isinstance(resolved_input, str) and runs.is_gateway_slash(resolved_input):
            from server.app_keys import ADAPTER_KEY
            handle = await runs.start_slash_run(
                adapter=request.app[ADAPTER_KEY],
                text=resolved_input,
                session_id=session_id,
            )
        else:
            handle = await runs.start_run(
                input_data=resolved_input,
                session_id=session_id,
                model=model,
                reasoning_effort=reasoning_effort,
                provider=provider,
                profile=profile,
                conversation_history=history,
                truncate_before_user_ordinal=truncate_ordinal,
            )
    except runs.RunCapExceeded as exc:
        return web.json_response(
            {"error": "rate_limit_exceeded", "detail": str(exc)}, status=429
        )
    except runs.SlashUnavailable as exc:
        return web.json_response(
            {"error": "slash_unavailable", "detail": str(exc)}, status=503
        )
    except runs.BranchTargetError as exc:
        return web.json_response(
            {"error": "stale_branch_target", "detail": str(exc)}, status=409
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("[hms.runs] start_run failed")
        return web.json_response({"error": "internal_error", "detail": str(exc)}, status=500)

    return web.json_response(
        {
            "run_id": handle.run_id,
            "session_id": handle.session_id,
            "status": handle.status,
        },
        status=202,
    )


@router.post("/api/runs/{run_id}/stop")
async def stop_run_route(request: web.Request) -> web.Response:
    run_id = request.match_info["run_id"]
    if not _RUN_ID_RE.match(run_id):
        return web.json_response({"error": "invalid_run_id"}, status=400)
    found = await runs.stop_run(run_id)
    if not found:
        return web.json_response({"error": "not_found"}, status=404)
    return web.json_response({"ok": True})


@router.get("/api/runs/active")
async def list_active_runs(request: web.Request) -> web.Response:
    """In-flight runs the SPA renders as 'in progress' Recents rows for sessions
    not yet in state.db (upstream persists on completion). Display-only: once a
    session lands in the DB — with its LLM-generated title — the client drops
    the synthetic row by session_id. Registered before ``{run_id}`` so the
    literal path wins over the dynamic one.
    """
    handles = await runs.get_registry().list_active()
    return web.json_response({
        "runs": [
            {
                "run_id": h.run_id,
                "session_id": h.session_id,
                "started_at": h.started_at or h.created_at,
                "title": (h.user_input or "").strip()[:80],
            }
            for h in handles
        ]
    })


@router.get("/api/runs/{run_id}")
async def get_run_route(request: web.Request) -> web.Response:
    run_id = request.match_info["run_id"]
    if not _RUN_ID_RE.match(run_id):
        return web.json_response({"error": "invalid_run_id"}, status=400)
    handle = await runs.get_registry().get(run_id)
    if handle is None:
        return web.json_response({"error": "not_found"}, status=404)
    return web.json_response({
        "run_id": handle.run_id,
        "session_id": handle.session_id,
        "status": handle.status,
        "model": handle.model,
        "created_at": handle.created_at,
        "started_at": handle.started_at,
        "ended_at": handle.ended_at,
        "output": handle.output,
        "error": handle.error,
        "usage": handle.usage,
    })


@router.get("/api/runs/{run_id}/transcript")
async def get_run_transcript(request: web.Request) -> web.Response:
    """In-flight turn snapshot for re-attach.

    Returns the *durable* accumulated partial (text / reasoning / tool cards)
    that the bounded replay ring may have evicted on a long run, plus the
    current ``seq`` so the client dedups the live frames it then receives over
    the WS. ``?since=<seq>`` additionally returns the buffered frames newer
    than that seq (fine-grained replay).
    """
    run_id = request.match_info["run_id"]
    if not _RUN_ID_RE.match(run_id):
        return web.json_response({"error": "invalid_run_id"}, status=400)
    handle = await runs.get_registry().get(run_id)
    if handle is None:
        return web.json_response({"error": "not_found"}, status=404)
    snap = handle.partial_snapshot()
    body = {
        "run_id": handle.run_id,
        "session_id": handle.session_id,
        "status": handle.status,
        "seq": snap["seq"],
        "user_input": handle.user_input,
        # Lets a re-attach restore the turn timer from the real start instead
        # of restarting at 0 on refresh.
        "started_at": handle.started_at,
        "partial": {
            "text": snap["text"],
            "reasoning": snap["reasoning"],
            "tool_calls": snap["tool_calls"],
        },
    }
    since_raw = request.query.get("since")
    if since_raw is not None:
        try:
            since = int(since_raw)
        except ValueError:
            return web.json_response({"error": "invalid_since"}, status=400)
        body["frames"] = handle.replay_since(since)
    return web.json_response(body)


def attach(app: web.Application) -> None:
    app.router.add_routes(router)


__all__ = ["attach"]
