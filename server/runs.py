"""Run lifecycle — AIAgent execution + WS broadcast of stream events."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from server.approvals import get_bridge as get_approval_bridge
from server.lib import config_reader, run_snapshot
from server.lib.profile_run import profile_home_override, resolve_profile_home
from server.lib.state_db import db, db_for_home
from server.lib.upstream_shim import shim
from server.ws import get_ws_manager

logger = logging.getLogger(__name__)

# Per-run replay buffer depth. A brief WS outage (mobile bg→fg, flaky wifi)
# can drop frames the server already fired; on re-subscribe we replay the
# tail so tool cards / deltas aren't permanently lost. Bounded so a long run
# can't grow memory without limit — overflow is covered by the client's
# reconcile-on-completion path.
RUN_RING_MAX = 512

# How often an in-flight turn is checkpointed to disk for crash recovery. The
# live answer is in memory + replayable to a re-attaching client; this only has
# to be coarse enough to bound what a hard crash loses (a few seconds of stream).
SNAPSHOT_INTERVAL_S = 3.0


async def _snapshot_loop(handle: RunHandle, loop: asyncio.AbstractEventLoop) -> None:
    """Checkpoint the in-flight partial every few seconds so a gateway crash
    can still recover the answer. Cancelled (and the sidecar deleted) the moment
    the run reaches a terminal — a clean turn is durable in state.db by then."""
    try:
        while True:
            await asyncio.sleep(SNAPSHOT_INTERVAL_S)
            snap = handle.partial_snapshot()
            if not (snap["text"] or snap["reasoning"] or snap["tool_calls"]):
                continue
            await loop.run_in_executor(
                None, run_snapshot.write,
                handle.run_id, handle.session_id, snap, handle.user_input,
            )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.debug("[hms.runs] snapshot loop error", exc_info=True)


@dataclass
class RunHandle:
    run_id: str
    session_id: str
    status: str
    created_at: float
    started_at: float | None = None
    ended_at: float | None = None
    model: str | None = None
    provider: str | None = None
    # Profile this run executes under. None / "default" runs
    # on the process HERMES_HOME; a named profile re-scopes via profile_run.
    profile: str | None = None
    # The user's prompt text — kept so a re-attach (refresh mid-run) can restore
    # the user bubble too; upstream only persists it to state.db on completion,
    # so without this a refresh before completion loses the user's message.
    user_input: str = ""
    output: str | None = None
    error: str | None = None
    usage: dict[str, int] = field(default_factory=dict)
    agent: Any = None
    task: asyncio.Task | None = None
    # Monotonic per-run frame counter + replay ring. Stamped under a lock
    # because worker-thread callbacks (deltas/tools) and the loop thread
    # (stop → run.cancelled) can both emit concurrently.
    seq: int = 0
    ring: deque[dict] = field(default_factory=lambda: deque(maxlen=RUN_RING_MAX))
    seq_lock: threading.Lock = field(default_factory=threading.Lock)
    # Durable accumulation of the in-flight turn. The ring is
    # bounded (512), so a long run evicts early frames and a re-attach (refresh /
    # session switch) couldn't rebuild the turn from replay alone. These grow
    # with the *response size* (one turn), not the frame count, so the transcript
    # endpoint can always hand a re-attaching client the full partial answer.
    partial_text: str = ""
    partial_reasoning: str = ""
    partial_tools: dict[str, dict] = field(default_factory=dict)

    def stamp(self, frame: dict) -> dict:
        """Assign the next seq, buffer the frame, accumulate, return for broadcast."""
        with self.seq_lock:
            self.seq += 1
            frame["seq"] = self.seq
            self.ring.append(frame)
            self._accumulate(frame)
        return frame

    def _accumulate(self, frame: dict) -> None:
        """Fold a frame into the durable partial-turn snapshot (called under lock)."""
        ev = frame.get("event")
        if ev == "message.delta":
            self.partial_text += frame.get("delta") or ""
        elif ev == "reasoning.available":
            self.partial_reasoning += frame.get("text") or ""
        elif ev == "tool.started":
            tcid = str(frame.get("tool_call_id") or "")
            self.partial_tools[tcid] = {
                "tool_call_id": tcid,
                "tool": frame.get("tool"),
                "preview": frame.get("preview", ""),
                "status": "running",
            }
        elif ev == "tool.completed":
            tcid = str(frame.get("tool_call_id") or "")
            cur = self.partial_tools.get(tcid) or {"tool_call_id": tcid, "tool": frame.get("tool")}
            cur["status"] = "error" if frame.get("error") else "done"
            if frame.get("duration") is not None:
                cur["duration"] = frame.get("duration")
            self.partial_tools[tcid] = cur

    def replay_since(self, last_seq: int) -> list[dict]:
        """Buffered frames with seq > last_seq, oldest first (for re-subscribe)."""
        with self.seq_lock:
            return [f for f in self.ring if f.get("seq", 0) > last_seq]

    def partial_snapshot(self) -> dict:
        """The accumulated in-flight turn — what a re-attaching client renders
        before live frames resume."""
        with self.seq_lock:
            return {
                "seq": self.seq,
                "text": self.partial_text,
                "reasoning": self.partial_reasoning,
                "tool_calls": list(self.partial_tools.values()),
            }


class RunRegistry:
    def __init__(self) -> None:
        self._runs: dict[str, RunHandle] = {}
        self._lock = asyncio.Lock()
        self._sem: asyncio.Semaphore | None = None

    async def _semaphore(self) -> asyncio.Semaphore:
        # Lazy so the cap reflects latest config.yaml at adapter boot, not module import time.
        if self._sem is None:
            self._sem = asyncio.Semaphore(config_reader.max_concurrent_runs())
        return self._sem

    async def add(self, handle: RunHandle) -> None:
        async with self._lock:
            self._runs[handle.run_id] = handle

    async def get(self, run_id: str) -> RunHandle | None:
        async with self._lock:
            return self._runs.get(run_id)

    async def list_active(self) -> list[RunHandle]:
        """Runs still queued/running — the SPA surfaces these as in-progress
        sidebar rows for sessions not yet persisted to state.db."""
        async with self._lock:
            return [r for r in self._runs.values() if r.status in ("queued", "running")]

    async def remove(self, run_id: str) -> None:
        async with self._lock:
            self._runs.pop(run_id, None)

    async def reserve(self, handle: RunHandle, cap: int) -> None:
        """Atomically enforce the concurrent-run cap and register the handle.

        Counting active runs and inserting under one lock closes a TOCTOU where
        two near-simultaneous POST /api/runs could each pass a separate count
        check and both slip past ``cap``. Raises RunCapExceeded at/over cap.
        """
        async with self._lock:
            active = sum(
                1 for r in self._runs.values() if r.status in ("queued", "running")
            )
            if active >= cap:
                raise RunCapExceeded(f"max_concurrent_runs={cap} reached")
            self._runs[handle.run_id] = handle


_default_registry: RunRegistry | None = None


def get_registry() -> RunRegistry:
    global _default_registry
    if _default_registry is None:
        _default_registry = RunRegistry()
    return _default_registry


def reset_for_test() -> None:
    global _default_registry
    _default_registry = None


class RunCapExceeded(RuntimeError):
    pass


class SlashUnavailable(RuntimeError):
    """A gateway slash command was dispatched but the adapter isn't connected
    (e.g. `hms dev` runs the backend standalone, with no gateway). Slash
    commands work when Station runs as the real gateway plugin."""


class BranchTargetError(RuntimeError):
    """The user message a regenerate / edit targets is no longer in the session
    transcript (it was already truncated away by a prior branch). The client
    should refetch and retry instead of branching from a stale ordinal."""


async def _truncate_session_history(
    session_id: str, profile: str | None, ordinal: int
) -> list[dict[str, Any]]:
    """Truncate a session's persisted transcript before its ``ordinal``-th user
    turn and return the surviving conversation history.

    In-session regenerate / branch: re-running the Nth user prompt drops that
    turn and everything after it from ``state.db`` (matching the gateway's
    ``prompt.submit`` ``truncate_before_user_ordinal``), so the new turn extends
    the truncated transcript. The superseded answer survives only in the
    client's in-memory branch list, exactly like upstream desktop.
    """
    profile_home = resolve_profile_home(profile)
    session_db = db() if profile_home is None else db_for_home(profile_home)
    loop = asyncio.get_running_loop()

    def _do() -> list[dict[str, Any]]:
        conv = session_db.get_messages_as_conversation(session_id)
        user_indices = [i for i, m in enumerate(conv) if m.get("role") == "user"]
        if ordinal >= len(user_indices):
            raise BranchTargetError(
                "target user message is no longer in session history"
            )
        truncated = conv[: user_indices[ordinal]]
        session_db.replace_messages(session_id, truncated)
        return truncated

    return await loop.run_in_executor(None, _do)


def _terminal_frame(handle: RunHandle, event: str, **fields: Any) -> dict:
    """Build + stamp a terminal ``run.event`` frame — the single definition of
    the run-completion contract shared by *both* run paths (AIAgent + slash).

    ``event`` is one of ``run.completed`` / ``run.failed`` / ``run.cancelled``.
    Every terminal frame carries ``session_id`` so the SPA reconciles without
    racing a store read; per-event extras (output / usage / error / timestamp)
    ride in ``**fields``.
    """
    return handle.stamp({
        "type": "run.event",
        "run_id": handle.run_id,
        "event": event,
        "session_id": handle.session_id,
        **fields,
    })


def _user_display_text(input_data: str | list[dict[str, Any]]) -> str:
    """The user's typed prompt, for restoring the user bubble on re-attach — the
    first text part of a multimodal input, or the raw string."""
    if isinstance(input_data, str):
        return input_data
    for item in input_data:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                return text
    return ""


async def start_run(
    *,
    input_data: str | list[dict[str, Any]],
    session_id: str | None = None,
    model: str | None = None,
    provider: str | None = None,
    reasoning_effort: str | None = None,
    profile: str | None = None,
    conversation_history: list[dict[str, Any]] | None = None,
    truncate_before_user_ordinal: int | None = None,
) -> RunHandle:
    registry = get_registry()
    sem = await registry._semaphore()

    run_id = f"run_{uuid.uuid4().hex}"
    effective_session_id = session_id or run_id

    # In-session regenerate / branch: drop the targeted user turn (and the rest
    # of the transcript) from state.db, then re-run from there. Done before the
    # handle is reserved so a stale target fails cleanly with nothing to unwind;
    # the truncated transcript becomes this run's history.
    if truncate_before_user_ordinal is not None:
        if session_id is None:
            raise BranchTargetError(
                "truncate_before_user_ordinal requires an existing session"
            )
        conversation_history = await _truncate_session_history(
            session_id, profile, truncate_before_user_ordinal
        )
    handle = RunHandle(
        run_id=run_id,
        session_id=effective_session_id,
        status="queued",
        created_at=time.time(),
        model=model,
        provider=provider,
        profile=profile,
        user_input=_user_display_text(input_data),
    )
    await registry.reserve(handle, config_reader.max_concurrent_runs())

    loop = asyncio.get_running_loop()
    handle.task = asyncio.create_task(
        _run_to_completion(
            handle=handle,
            input_data=input_data,
            reasoning_effort=reasoning_effort,
            conversation_history=conversation_history or [],
            sem=sem,
            loop=loop,
        )
    )
    return handle


def is_gateway_slash(text: str) -> bool:
    """True iff text is a gateway-dispatchable slash command per upstream's registry."""
    if not text.startswith("/"):
        return False
    parts = text.split(maxsplit=1)
    if not parts:
        return False
    canonical = parts[0][1:].split("@", 1)[0].lower()
    if not canonical or "/" in canonical:
        return False
    resolve = shim.commands.resolve_command
    is_known = shim.commands.is_gateway_known
    if resolve is None or is_known is None:
        return False
    cmd = resolve(canonical)
    if cmd is None:
        return False
    return bool(is_known(cmd.name))


def _workspace_context_history() -> list[dict[str, Any]]:
    """A one-item system preface telling the agent its working directory so
    file operations use absolute paths under it.

    Uses the *resolved* cwd (`resolve_active_cwd`) — a chosen workspace, the
    ``hermes`` sentinel, or the ``~/workspace`` default — so even the default
    case gets an explicit absolute dir and the agent never resolves relative
    paths against the process cwd (which in dev is the repo). Injected per-run
    (not persisted) — os.chdir is unsafe with concurrent in-process runs.
    """
    try:
        from server.lib.workspace_cwd import resolve_active_cwd
        from server.routes.files import active_workspace
        name, _ = active_workspace()
        path = resolve_active_cwd()
    except Exception:
        return []
    label = f" (name: {name})" if name else ""
    return [{
        "role": "system",
        "content": (
            f"Current workspace: {path}{label}. "
            "Use absolute paths under this directory for file operations."
        ),
    }]


def _build_hms_event(text: str, session_id: str) -> Any:
    """Construct a MessageEvent the gateway's _handle_message can dispatch.

    Reuses upstream's dataclasses so the gateway sees the same shape it
    gets from telegram / slack / etc. — no separate code path in upstream.
    """
    from gateway.config import Platform  # hms-allow-hardcoding
    from gateway.platforms.base import MessageEvent  # hms-allow-hardcoding
    from gateway.session import SessionSource  # hms-allow-hardcoding

    source = SessionSource(
        platform=Platform("station"),
        chat_id=session_id,
        chat_type="dm",
        user_id="hms",
        user_name="hms",
    )
    return MessageEvent(text=text, source=source)


async def start_slash_run(
    *,
    adapter: Any,
    text: str,
    session_id: str | None = None,
) -> RunHandle:
    """Route a gateway-known slash command through upstream's _handle_message.

    The dispatcher is injected at adapter.connect() time as
    ``adapter._message_handler`` — same surface telegram / slack use.
    Response is broadcast over WS on ``run:<run_id>`` like agent runs,
    so the SPA's streaming code path is unchanged.
    """
    registry = get_registry()
    handler = getattr(adapter, "_message_handler", None) if adapter is not None else None
    if handler is None:
        raise SlashUnavailable(
            "Slash commands need the running gateway — they're unavailable when "
            "the backend runs standalone (e.g. `hms dev`)."
        )

    run_id = f"run_{uuid.uuid4().hex}"
    effective_session_id = session_id or run_id
    handle = RunHandle(
        run_id=run_id,
        session_id=effective_session_id,
        status="queued",
        created_at=time.time(),
    )
    await registry.reserve(handle, config_reader.max_concurrent_runs())

    ws = get_ws_manager()
    channel = f"run:{run_id}"

    async def _dispatch() -> None:
        handle.status = "running"
        handle.started_at = time.time()
        try:
            event = _build_hms_event(text, effective_session_id)
            response = await handler(event)
            output = response if isinstance(response, str) else ""
            handle.output = output
            handle.status = "completed"
            handle.ended_at = time.time()
            if output:
                # _dispatch runs on the loop, so await the broadcast directly
                # (the worker-thread broadcast_threadsafe path is for callbacks).
                await ws.broadcast(channel, handle.stamp({
                    "type": "run.event",
                    "run_id": run_id,
                    "event": "message.delta",
                    "delta": output,
                    "timestamp": time.time(),
                }))
            await ws.broadcast(channel, _terminal_frame(handle, "run.completed", output=output))
        except Exception as exc:  # noqa: BLE001
            logger.exception("[hms.runs] slash dispatch failed for %r", text)
            handle.status = "failed"
            handle.error = str(exc)
            handle.ended_at = time.time()
            await ws.broadcast(channel, _terminal_frame(handle, "run.failed", error=handle.error))
        finally:
            await get_registry().remove(handle.run_id)

    handle.task = asyncio.create_task(_dispatch())
    return handle


async def _run_to_completion(
    *,
    handle: RunHandle,
    input_data: str | list[dict[str, Any]],
    reasoning_effort: str | None,
    conversation_history: list[dict[str, Any]],
    sem: asyncio.Semaphore,
    loop: asyncio.AbstractEventLoop,
) -> None:
    ws = get_ws_manager()
    channel = f"run:{handle.run_id}"

    async with sem:
        handle.status = "running"
        handle.started_at = time.time()
        # A new turn supersedes any crashed-run sidecar left for this session by
        # a previous gateway death — once we're producing fresh output, the old
        # interrupted partial is stale.
        await loop.run_in_executor(None, run_snapshot.delete_for_session, handle.session_id)

        # Profile re-scoping: a named profile points the run
        # at that profile's HERMES_HOME (config / .env / skills / memory) via
        # the override, and at its own state.db via db_for_home — without
        # spawning a sibling gateway or restarting. None → process default.
        profile_home = resolve_profile_home(handle.profile)

        if not conversation_history:
            try:
                # Default profile → the shared singleton db(); a named profile
                # → that profile's own state.db (the override doesn't reach an
                # already-constructed SessionDB).
                _session_db = db() if profile_home is None else db_for_home(profile_home)
                conversation_history = await loop.run_in_executor(
                    None,
                    _session_db.get_messages_as_conversation,
                    handle.session_id,
                )
            except Exception as _hist_exc:
                logger.warning(
                    "[hms.runs] failed to load conversation history for %s: %s",
                    handle.session_id,
                    _hist_exc,
                )
                conversation_history = []

        # Make the agent aware of its active workspace (absolute path).
        ws_context = _workspace_context_history()
        if ws_context:
            conversation_history = [*ws_context, *conversation_history]

        def _build_under_profile() -> Any:
            # The override is a ContextVar read on this worker thread, so apply
            # it here (run_in_executor doesn't copy the caller's context).
            with profile_home_override(handle.profile):
                return _build_agent(handle, reasoning_effort, loop)

        try:
            handle.agent = await loop.run_in_executor(
                None,
                _build_under_profile,
            )
        except Exception as exc:
            logger.exception("[hms.runs] agent construction failed: %s", exc)
            handle.status = "failed"
            handle.error = str(exc)
            handle.ended_at = time.time()
            await ws.broadcast(channel, _terminal_frame(handle, "run.failed", error=handle.error))
            await get_registry().remove(handle.run_id)
            return

        # Register approval bridge before run, unregister after — even on exception —
        # so a crashed agent never leaves a phantom drawer in the UI.
        bridge = get_approval_bridge()
        bridge.register(handle.session_id, handle.run_id)

        set_vars = shim.session_context.set_session_vars
        clear_vars = shim.session_context.clear_session_vars

        def _run_in_thread() -> Any:
            token = bridge.bind_session_key(handle.session_id)
            # Set platform/session_key vars so upstream tools (kanban notifier, cron
            # auto-deliver, runtime footer) see this run instead of stale values.
            session_tokens = (
                set_vars(
                    platform="station",
                    session_key=handle.session_id,
                    chat_id=handle.session_id,
                    user_id="hms",
                    user_name="Station",
                )
                if set_vars is not None else []
            )
            try:
                # Keep the HERMES_HOME override active for the whole turn so
                # tools/config/.env resolve under the selected profile.
                with profile_home_override(handle.profile):
                    return handle.agent.run_conversation(
                        user_message=input_data,
                        conversation_history=conversation_history,
                        task_id=handle.session_id,
                    )
            finally:
                if session_tokens and clear_vars is not None:
                    try:
                        clear_vars(session_tokens)
                    except Exception:
                        logger.debug("[hms.runs] clear_session_vars failed", exc_info=True)
                bridge.unbind_session_key(token)

        # Checkpoint the in-flight turn to disk while it runs so a hard crash
        # can recover the partial; cancelled + cleaned up in the finally below.
        snapshot_task = asyncio.create_task(_snapshot_loop(handle, loop))
        try:
            result: Any = None
            run_exc: Exception | None = None
            try:
                result = await loop.run_in_executor(None, _run_in_thread)
            except Exception as exc:
                logger.exception("[hms.runs] run %s failed", handle.run_id)
                run_exc = exc

            # stop_run may have flipped status to cancelled — suppress natural completed/failed
            # broadcast in that case since the SPA already cleared on run.cancelled.
            cancelled = handle.status == "cancelled"
            agent = handle.agent
            usage = {
                "input_tokens": int(getattr(agent, "session_prompt_tokens", 0) or 0),
                "output_tokens": int(getattr(agent, "session_completion_tokens", 0) or 0),
                "total_tokens": int(getattr(agent, "session_total_tokens", 0) or 0),
            }
            handle.usage = usage
            handle.ended_at = time.time()

            final = ""
            if run_exc is not None:
                if not cancelled:
                    handle.status = "failed"
                    handle.error = str(run_exc)
                    await ws.broadcast(
                        channel,
                        _terminal_frame(handle, "run.failed", error=handle.error),
                    )
            elif isinstance(result, dict) and result.get("failed"):
                if not cancelled:
                    handle.status = "failed"
                    handle.error = result.get("error") or "agent run failed"
                    await ws.broadcast(
                        channel,
                        _terminal_frame(handle, "run.failed", error=handle.error),
                    )
            else:
                final = result.get("final_response", "") if isinstance(result, dict) else ""
                handle.output = final
                if not cancelled:
                    handle.status = "completed"
                    await ws.broadcast(
                        channel,
                        _terminal_frame(handle, "run.completed", output=final, usage=usage),
                    )

            # Upstream guard (user_msg_count > 2) makes this a no-op past first turns.
            if not cancelled and agent is not None:
                _maybe_auto_title(
                    agent=agent,
                    session_id=handle.session_id,
                    user_message=(
                        input_data if isinstance(input_data, str)
                        else " ".join(
                            p.get("text") or p.get("content", "")
                            for p in input_data
                            if isinstance(p, dict) and p.get("type") != "image_url"
                        )
                    ),
                    assistant_response=final,
                    conversation_history=(
                        result.get("messages") or [] if isinstance(result, dict) else []
                    ),
                    profile=handle.profile,
                )
        finally:
            snapshot_task.cancel()
            # Terminal reached → the answer is durable in state.db; drop the crash
            # sidecar so it isn't mistaken for an orphan on the next restart.
            try:
                await loop.run_in_executor(None, run_snapshot.delete, handle.run_id)
            except Exception:
                logger.debug("[hms.runs] snapshot delete failed", exc_info=True)
            # Unregister AFTER broadcast — wakes agent threads still blocked on event.wait().
            bridge.unregister(handle.session_id)
            await get_registry().remove(handle.run_id)


def _build_agent(
    handle: RunHandle,
    reasoning_effort: str | None,
    loop: asyncio.AbstractEventLoop,
) -> Any:
    session_id = handle.session_id
    model = handle.model
    provider = handle.provider
    run_id = handle.run_id
    GatewayRunner = shim.gateway.GatewayRunner
    _load_gateway_config = shim.gateway.load_gateway_config
    _resolve_gateway_model = shim.gateway.resolve_gateway_model
    _resolve_runtime_agent_kwargs = shim.gateway.resolve_runtime_agent_kwargs
    _get_platform_tools = shim.gateway.get_platform_tools
    AIAgent = shim.run_agent.AIAgent

    missing = [
        name for name, val in (
            ("AIAgent", AIAgent),
            ("GatewayRunner", GatewayRunner),
            ("_load_gateway_config", _load_gateway_config),
            ("_resolve_gateway_model", _resolve_gateway_model),
            ("_resolve_runtime_agent_kwargs", _resolve_runtime_agent_kwargs),
            ("_get_platform_tools", _get_platform_tools),
        ) if val is None
    ]
    if missing:
        raise RuntimeError(
            f"upstream hermes-agent missing symbols: {missing}; "
            "is the venv installed and on PYTHONPATH?"
        )

    # The `missing` guard above already raised if any were None; re-assert so the
    # type checker narrows these Optional shim symbols before they're called.
    assert (
        _load_gateway_config is not None
        and _resolve_gateway_model is not None
        and _resolve_runtime_agent_kwargs is not None
        and _get_platform_tools is not None
        and AIAgent is not None
    )

    runtime_kwargs = _resolve_runtime_agent_kwargs()

    # Frontend can override provider per-run; re-resolve credentials for that provider.
    if provider and provider != runtime_kwargs.get("provider", ""):
        _resolve_runtime_provider = shim.gateway.resolve_runtime_provider
        if _resolve_runtime_provider is not None:
            try:
                override = _resolve_runtime_provider(requested=provider)
                runtime_kwargs = {
                    "api_key": override.get("api_key"),
                    "base_url": override.get("base_url"),
                    "provider": override.get("provider"),
                    "api_mode": override.get("api_mode"),
                    "command": override.get("command"),
                    "args": list(override.get("args") or []),
                    "credential_pool": override.get("credential_pool"),
                }
                logger.info(
                    "[hms.runs] provider override applied: %r → %r",
                    provider, override.get("provider"),
                )
            except Exception:
                logger.exception(
                    "[hms.runs] provider override failed (%r) — using config default", provider
                )
        else:
            logger.warning(
                "[hms.runs] resolve_runtime_provider unavailable — "
                "provider override (%r) skipped",
                provider,
            )

    reasoning_config = (
        shim.gateway.load_reasoning_config()
        if shim.gateway.load_reasoning_config is not None
        else None
    )
    resolved_model = model or _resolve_gateway_model()

    user_config = _load_gateway_config()
    enabled_toolsets = sorted(_get_platform_tools(user_config, "station"))

    fallback_model = (
        shim.gateway.load_fallback_model()
        if shim.gateway.load_fallback_model is not None
        else None
    )

    ws = get_ws_manager()
    channel = f"run:{run_id}"

    def _cancelled() -> bool:
        return handle.status == "cancelled"

    def _on_delta(delta: str | None) -> None:
        if _cancelled():
            return
        if delta is None:
            # Upstream sends None as "close stream box" before a tool call (run_agent.py ~15266).
            ws.broadcast_threadsafe(channel, handle.stamp({
                "type": "run.event",
                "run_id": run_id,
                "event": "stream.reset",
                "timestamp": time.time(),
            }))
            return
        if not delta:
            return
        ws.broadcast_threadsafe(channel, handle.stamp({
            "type": "run.event",
            "run_id": run_id,
            "event": "message.delta",
            "delta": delta,
            "timestamp": time.time(),
        }))

    # Upstream contract (run_agent.py:9881, 10112, 10245, 10500):
    #   tool_start_callback(tool_call_id, name, args)
    #   tool_complete_callback(tool_call_id, name, args, result)
    def _on_tool_start(tool_call_id: str, tool: str, args: Any = None) -> None:
        if _cancelled():
            return
        preview: str = ""
        if isinstance(args, dict):
            for key in ("command", "url", "path", "query"):
                v = args.get(key)
                if isinstance(v, str) and v:
                    preview = v[:300]
                    break
            if not preview:
                preview = str(args)[:300]
        elif isinstance(args, str):
            preview = args[:300]
        ws.broadcast_threadsafe(channel, handle.stamp({
            "type": "run.event",
            "run_id": run_id,
            "event": "tool.started",
            # tool_call_id keeps separate cards for concurrent invocations of the same tool.
            "tool_call_id": tool_call_id,
            "tool": tool,
            "preview": preview,
            "timestamp": time.time(),
        }))

    def _on_tool_complete(
        tool_call_id: str, tool: str, args: Any, result: Any = None,
    ) -> None:
        if _cancelled():
            return
        # Upstream callback has no explicit error flag — infer from result text.
        is_error = False
        if isinstance(result, str):
            head = result.lstrip()[:60].lower()
            is_error = head.startswith("error") or head.startswith("traceback")
        ws.broadcast_threadsafe(channel, handle.stamp({
            "type": "run.event",
            "run_id": run_id,
            "event": "tool.completed",
            "tool_call_id": tool_call_id,
            "tool": tool,
            "error": is_error,
            "timestamp": time.time(),
        }))

    def _on_reasoning(text: str | None) -> None:
        if _cancelled() or not text:
            return
        ws.broadcast_threadsafe(channel, handle.stamp({
            "type": "run.event",
            "run_id": run_id,
            "event": "reasoning.available",
            "text": text,
            "timestamp": time.time(),
        }))

    # persist this run's sessions to the *active profile's*
    # own state.db, not the default home's. A SessionDB captures its path at
    # construction, so the HERMES_HOME override can't redirect an already-built
    # one — select the right DB explicitly, mirroring the history-load path in
    # _run_to_completion. None (default/unset profile) → the shared singleton.
    profile_home = resolve_profile_home(handle.profile)

    agent = AIAgent(
        model=resolved_model,
        **runtime_kwargs,
        quiet_mode=True,
        verbose_logging=False,
        ephemeral_system_prompt=None,
        enabled_toolsets=enabled_toolsets,
        session_id=session_id,
        platform="station",
        stream_delta_callback=_on_delta,
        tool_start_callback=_on_tool_start,
        tool_complete_callback=_on_tool_complete,
        reasoning_callback=_on_reasoning,
        session_db=db() if profile_home is None else db_for_home(profile_home),
        fallback_model=fallback_model,
        reasoning_config=reasoning_config,
    )
    # AIAgent reads reasoning_config dict, NOT a bare reasoning_effort string —
    # setting the string was silently ignored. See hermes_constants.parse_reasoning_effort.
    if reasoning_effort:
        if reasoning_effort.strip().lower() == "none":
            agent.reasoning_config = {"enabled": False, "effort": "low"}
        else:
            try:
                parse_reasoning_effort = shim.run_agent.parse_reasoning_effort
                if parse_reasoning_effort is not None:
                    parsed = parse_reasoning_effort(reasoning_effort)
                    if parsed is not None:
                        agent.reasoning_config = parsed
            except Exception:
                logger.exception(
                    "[hms.runs] reasoning_effort override failed (%r)", reasoning_effort
                )
    return agent


def _maybe_auto_title(
    *,
    agent: Any,
    session_id: str,
    user_message: str,
    assistant_response: str,
    conversation_history: list[dict[str, Any]],
    profile: str | None = None,
) -> None:
    """Fire-and-forget LLM title generation; upstream guards make this cheap to call every time."""
    try:
        from agent.title_generator import maybe_auto_title  # type: ignore[import-not-found]
    except Exception:
        logger.debug("[hms.runs] title_generator unavailable", exc_info=True)
        return

    # write the generated title to the active profile's state.db, matching
    # where _build_agent persisted the session — not the default home.
    profile_home = resolve_profile_home(profile)
    try:
        maybe_auto_title(
            db() if profile_home is None else db_for_home(profile_home),
            session_id,
            user_message,
            assistant_response,
            conversation_history or [],
            failure_callback=getattr(agent, "_emit_auxiliary_failure", None),
            main_runtime={
                "model": getattr(agent, "model", None),
                "provider": getattr(agent, "provider", None),
                "base_url": getattr(agent, "base_url", None),
                "api_key": getattr(agent, "api_key", None),
                "api_mode": getattr(agent, "api_mode", None),
            },
        )
    except Exception:
        logger.warning("[hms.runs] auto-title kick-off failed", exc_info=True)


async def stop_run(run_id: str) -> bool:
    """Mark cancelled and broadcast immediately; the agent's cooperative interrupt may lag."""
    handle = await get_registry().get(run_id)
    if handle is None:
        return False
    if handle.status not in ("cancelled", "completed", "failed"):
        handle.status = "cancelled"
        await get_ws_manager().broadcast(
            f"run:{run_id}",
            _terminal_frame(handle, "run.cancelled", timestamp=time.time()),
        )
    agent = handle.agent
    if agent is not None:
        try:
            agent.interrupt("stopped by user")
        except Exception:
            logger.exception("[hms.runs] interrupt failed for %s", run_id)
    return True
