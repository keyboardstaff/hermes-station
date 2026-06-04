import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChatStore } from "@/store/chat";
import { useWSStore } from "@/store/ws";
import type { ComposerAttachment, ContentPart, RunInput, ToolCall } from "@/lib/hermes-types";
import type { RunEventMessage } from "@/lib/ws-types";
import { api } from "@/lib/api";
import { toolResultsById } from "@/lib/load-session";
import type { MessageRow } from "@/lib/session-messages";
import { shouldApplyFrame, toolCallId, mapToolStatus } from "@/lib/run-events";

/** Chat run lifecycle: POST /api/runs → subscribe to run:<id> on the shared WS. */
export function useRunsStream() {
  const {
    setActiveRunId,
    appendMessage,
    appendDelta,
    appendReasoning,
    appendToolCallPart,
    upsertToolCall,
    patchToolResultsById,
    setFinalContent,
    setActiveTurn,
    setRunningForSession,
    clearRunningForSession,
    renameMessageId,
    updateActiveSessionId,
    setAgentForRun,
    selectedModel,
    selectedProvider,
    reasoningEffort,
  } = useChatStore();
  const queryClient = useQueryClient();

  const connect = useWSStore((s) => s.connect);
  const subscribe = useWSStore((s) => s.subscribe);
  const unsubscribe = useWSStore((s) => s.unsubscribe);
  const send = useWSStore((s) => s.send);
  const on = useWSStore((s) => s.on);

  const subscribedChannelRef = useRef<string | null>(null);
  // Highest run-frame seq applied for the current run — drops replayed/duplicate
  // frames so a reconnect's ring replay can't double-apply deltas.
  const lastSeqRef = useRef(0);
  // MUST be invoked on detach — otherwise each new run leaks a closure in the global handlers Map.
  const offRunEventRef = useRef<(() => void) | null>(null);
  // Bumped on every detach/attach. attachRun's async transcript-seed captures the
  // generation it began in and bails if a newer attach/detach superseded it —
  // otherwise a rapid session switch (B→A→B) lets run A's partial land in B's
  // live turn (cross-session bleed) and leaks run A's channel into the global
  // subscription set (replayed on every reconnect).
  const attachGenRef = useRef(0);

  useEffect(() => { connect(); }, [connect]);

  const detach = useCallback(() => {
    attachGenRef.current++;
    const ch = subscribedChannelRef.current;
    if (ch) {
      unsubscribe(ch);
      subscribedChannelRef.current = null;
    }
    if (offRunEventRef.current) {
      offRunEventRef.current();
      offRunEventRef.current = null;
    }
  }, [unsubscribe]);

  useEffect(() => () => detach(), [detach]);

  // Reconnect guard: on transition back to open, re-verify activeRunId in case the
  // run completed during the outage (we'd have missed run.completed).
  const wsStatus = useWSStore((s) => s.status);
  const prevWsStatusRef = useRef(wsStatus);
  useEffect(() => {
    const wasDown = prevWsStatusRef.current !== "open";
    prevWsStatusRef.current = wsStatus;
    if (wsStatus !== "open" || !wasDown) return;
    const runId = useChatStore.getState().activeRunId;
    if (!runId) return;
    fetch(`/api/runs/${encodeURIComponent(runId)}`)
      .then((r) => (r.ok ? r.json() : { status: "unknown" }))
      .then((data: { status?: string }) => {
        if (data.status === "running" || data.status === "queued") return;
        setActiveRunId(null);
        setActiveTurn(null);
        const { activeSessionId: sid } = useChatStore.getState();
        if (sid) clearRunningForSession(sid);
        const msgs = useChatStore.getState().messages;
        const last = msgs[msgs.length - 1];
        if (last?.streaming) {
          useChatStore.setState({
            messages: msgs.map((m) =>
              m.id === last.id ? { ...m, streaming: false } : m
            ),
          });
        }
      })
      .catch(() => { /* best-effort */ });
  }, [wsStatus, setActiveRunId, setActiveTurn, clearRunningForSession]);

  // On a real session switch: drop the old run's subscription, then RE-ATTACH the
  // new session's run if one is still in flight (so switching away/back doesn't
  // orphan a running stream). null → newId on first send is NOT a switch.
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const lastSessionRef = useRef<string | null>(activeSessionId);
  useEffect(() => {
    const prev = lastSessionRef.current;
    if (prev === activeSessionId) return;
    lastSessionRef.current = activeSessionId;
    if (prev === null) return; // first send into a fresh session — sendMessage attaches.

    // Tear down the previous session's live subscription. Do NOT null
    // activeRunId/activeTurnId here: setActiveSession already re-pointed them at
    // THIS session's in-flight run, and clearing them re-opens the window where
    // the history reconcile (ChatPanel) sees no active run and wipes the live
    // turn — the user's prompt + half-streamed answer vanish on switch.
    detach();
    if (!activeSessionId) return;

    const runId = useChatStore.getState().runningBySession[activeSessionId];
    if (!runId) return;

    // Re-subscribe only if the server still considers the run live; a stale entry
    // (the run finished while we were away) clears the run + drops the spinner.
    const targetSession = activeSessionId;
    let cancelled = false;
    fetch(`/api/runs/${encodeURIComponent(runId)}`)
      .then((r) => (r.ok ? r.json() : { status: "gone" }))
      .then((data: { status?: string }) => {
        if (cancelled || useChatStore.getState().activeSessionId !== targetSession) return;
        if (data.status === "running" || data.status === "queued") {
          setActiveRunId(runId);
          attachRun(runId);
        } else {
          if (useChatStore.getState().activeRunId === runId) {
            setActiveRunId(null);
            setActiveTurn(null);
          }
          clearRunningForSession(targetSession);
        }
      })
      .catch(() => { /* best-effort; reconnect guard will re-verify */ });
    return () => { cancelled = true; };
    // attachRun is declared below; it's stable across renders (useCallback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, detach, setActiveRunId, setActiveTurn, clearRunningForSession]);

  const attachRun = useCallback(
    (runId: string) => {
      // Always detach first — stale closure with captured runId leaks + cross-pollinates.
      detach();
      // Capture the generation this attach owns (detach bumped it). The async
      // seed below bails if a newer attach/detach supersedes us mid-fetch.
      const myGen = attachGenRef.current;
      // All streaming events target turn-<runId>-assistant; set before any frame lands.
      setActiveTurn(runId);
      lastSeqRef.current = 0;
      const channel = `run:${runId}`;
      subscribedChannelRef.current = channel;

      const offRunEvent = on<RunEventMessage>("run.event", (msg) => {
        if (msg.run_id !== runId) return;
        // Drop already-applied frames (reconnect replay / duplicates). Frames
        // without a seq (legacy) always pass through.
        const seqCheck = shouldApplyFrame(msg.seq, lastSeqRef.current);
        if (!seqCheck.apply) return;
        lastSeqRef.current = seqCheck.lastSeq;
        switch (msg.event) {
          case "message.delta":
            if (msg.delta) appendDelta(msg.delta);
            break;
          case "stream.reset":
            // Final response arrives via run.completed.output; preemptive clear here
            // would delete legitimate pre-tool text.
            break;
          case "reasoning.available":
            // Belt-and-suspenders: upstream already suppresses these on "none".
            if (useChatStore.getState().reasoningEffort !== "none" && msg.text) {
              appendReasoning(msg.text);
            }
            break;
          case "tool.started": {
            if (!msg.tool) break;
            const tcId = toolCallId(runId, msg);
            appendToolCallPart({
              id: tcId,
              toolName: msg.tool,
              preview: msg.preview,
              status: "running",
            });
            break;
          }
          case "tool.completed": {
            if (!msg.tool) break;
            const tcId = toolCallId(runId, msg);
            const status = mapToolStatus(msg);

            upsertToolCall({
              id: tcId,
              toolName: msg.tool,
              duration: typeof msg.duration === "number" ? msg.duration : undefined,
              status,
            });
            break;
          }
          case "run.completed":
          case "run.failed":
          case "run.cancelled": {
            // output is run_conversation's final_response; empty on run.failed.
            if (msg.event === "run.completed" && msg.output) {
              setFinalContent(msg.output);
            }
            // Cumulative session usage → Composer context ring.
            if (msg.event === "run.completed" && msg.usage) {
              useChatStore.getState().setLastUsage(msg.usage);
            }
            const store = useChatStore.getState();
            const msgs = store.messages;
            const last = msgs[msgs.length - 1];
            if (last?.streaming) {
              useChatStore.setState({
                messages: msgs.map((m) =>
                  m.id === last.id ? { ...m, streaming: false } : m
                ),
              });
            }
            setActiveRunId(null);
            // Cleared AFTER setFinalContent above (which still needs the turn id).
            setActiveTurn(null);
            // session_id rides the terminal frame — avoids racing a store read.
            const sid = msg.session_id ?? useChatStore.getState().activeSessionId;
            if (sid) clearRunningForSession(sid);
            // Refetch now (persisted row), then a few more times as the run's
            // auto-title lands asynchronously — timing varies, especially for
            // concurrent runs — so the LLM title appears on its own rather than
            // only on a click/refresh. The provisionalTitles fallback covers the
            // gap so the row never reads "Untitled" in between.
            queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });
            for (const ms of [3000, 8000, 18000]) {
              setTimeout(
                () => queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] }),
                ms,
              );
            }

            // Fill tool-result bodies from the DB by tool_call_id — keeps the live
            // bubble (incl. reasoning / approval notices) but lands the persisted
            // result text on the matching cards. Wholesale reconcile happens on the
            // next session entry, not here, so live-only segments survive.
            if (sid) {
              fetch(`/api/sessions/${encodeURIComponent(sid)}/messages?limit=200`)
                .then((r) => (r.ok ? r.json() : { messages: [] }))
                .then((data: { messages: MessageRow[] }) => {
                  const byId = toolResultsById(data.messages ?? []);
                  if (Object.keys(byId).length > 0) patchToolResultsById(byId);
                })
                .catch(() => { /* best-effort */ });
            }
            detach();
            break;
          }
        }
      });
      offRunEventRef.current = offRunEvent;

      // seed the in-flight turn from the durable transcript BEFORE
      // subscribing, so a long run whose replay ring (512) evicted early frames
      // still reconstructs the full partial answer on refresh / session switch.
      // The WS ring replay then re-sends frames the seed already covered, but
      // lastSeqRef dedups them (shouldApplyFrame) so nothing doubles. Fetch
      // failure → just subscribe (the ring replay alone reconstructs short runs).
      (async () => {
        let data: {
          seq?: number;
          user_input?: string;
          partial?: {
            text?: string;
            reasoning?: string;
            tool_calls?: Array<{ tool_call_id: string; tool: string; preview?: string; status: ToolCall["status"] }>;
          };
        } | null = null;
        try {
          const r = await fetch(`/api/runs/${encodeURIComponent(runId)}/transcript`);
          if (r.ok) data = await r.json();
        } catch { /* best-effort; ring replay still reconstructs */ }
        // A newer attach/detach superseded us while awaiting → bail before any
        // store mutation or subscribe. Applying this run's partial now would
        // bleed it into the now-active turn, and subscribing would leak this
        // run's channel into the global subscription set.
        if (attachGenRef.current !== myGen) return;
        if (data) {
          // Restore the user bubble first — upstream persists it to state.db
          // only on completion, so a DB rebuild on a mid-run refresh lacks it
          // (the accumulator holds only the assistant side of the turn).
          const userId = `turn-${runId}-user`;
          if (data.user_input
            && !useChatStore.getState().messages.some((m) => m.id === userId)) {
            appendMessage({ id: userId, role: "user", content: data.user_input, createdAt: Date.now() });
          }
          const p = data.partial;
          if (p && (p.text || (p.tool_calls && p.tool_calls.length > 0))) {
            if (p.text) appendDelta(p.text);
            if (p.reasoning && useChatStore.getState().reasoningEffort !== "none") {
              appendReasoning(p.reasoning);
            }
            for (const tc of p.tool_calls ?? []) {
              appendToolCallPart({
                id: tc.tool_call_id, toolName: tc.tool, preview: tc.preview, status: tc.status,
              });
            }
            if (typeof data.seq === "number") lastSeqRef.current = data.seq;
          }
        }
        subscribe(channel);
      })();

      return offRunEvent;
    },
    [appendMessage, appendDelta, appendReasoning, appendToolCallPart, upsertToolCall,
      patchToolResultsById, setFinalContent, setActiveTurn, setActiveRunId,
      clearRunningForSession, queryClient, subscribe, on, detach]
  );

  // Resume persisted run on mount: re-subscribe and let server replay from last_seq.
  useEffect(() => {
    const { activeRunId: persistedRunId, activeSessionId: sid0, runningBySession } =
      useChatStore.getState();
    if (!persistedRunId) return;
    // Stale-run guard: only resume a run that belongs to the active session.
    // Otherwise re-attaching streams a *different* session's live content into
    // this one (cross-session bleed) — e.g. returning to /chat on session A
    // while session B is still running and activeRunId lagged behind.
    if (sid0 && runningBySession[sid0] !== persistedRunId) {
      setActiveRunId(null);
      setActiveTurn(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/runs/${encodeURIComponent(persistedRunId)}`);
        if (cancelled) return;
        const sid = useChatStore.getState().activeSessionId;
        if (!r.ok) {
          setActiveRunId(null);
          if (sid) clearRunningForSession(sid);
          return;
        }
        const data = (await r.json()) as { status?: string };
        if (data.status === "running" || data.status === "queued") {
          attachRun(persistedRunId);
        } else {
          setActiveRunId(null);
          if (sid) clearRunningForSession(sid);
          const msgs = useChatStore.getState().messages;
          const last = msgs[msgs.length - 1];
          if (last?.streaming) {
            useChatStore.setState({
              messages: msgs.map((m) =>
                m.id === last.id ? { ...m, streaming: false } : m
              ),
            });
          }
        }
      } catch {
        if (!cancelled) setActiveRunId(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback(
    async (input: string, attachments?: ComposerAttachment[], opts?: { profileOverride?: string }) => {
      const currentSessionId = useChatStore.getState().activeSessionId;

      // Optimistic user bubble with a collision-free temp id; rebound to
      // turn-<runId>-user once POST returns so refresh/reconcile can map it.
      const tempUserId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? `user-pending-${crypto.randomUUID()}`
          : `user-pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      appendMessage({
        id: tempUserId,
        role: "user",
        content: input,
        attachments: attachments?.map((a) => ({
          name: a.name, content: a.content,
          isImage: a.isImage, isAudio: a.isAudio, isVideo: a.isVideo,
        })),
        ...(opts?.profileOverride ? { agent: opts.profileOverride } : {}),
        createdAt: Date.now(),
      });

      // Structured ContentPart[] — never concat into a single text blob, breaks multi-part parsing.
      let runInput: string | ContentPart[];
      if (attachments && attachments.length > 0) {
        const parts: ContentPart[] = [{ type: "text", text: input }];
        for (const att of attachments) {
          if (att.isImage) {
            parts.push({ type: "image_url", image_url: { url: att.content } });
          } else {
            parts.push({ type: "text", text: `\`\`\`${att.name}\n${att.content}\n\`\`\`` });
          }
        }
        runInput = parts;
      } else {
        runInput = input;
      }

      // Active profile = the Composer pill's sticky selection (cached under
      // ["profile-active"]). Sending it lets the backend re-scope this run to
      // that profile's HERMES_HOME in-process, no restart.
      // Omit "default" — that's the process home already.
      const activeProfile = queryClient.getQueryData<{ sticky?: string }>(["profile-active"])?.sticky;
      // Agents room @mention routes THIS turn to a specific profile-agent's home.
      const runProfile = opts?.profileOverride ?? activeProfile;

      // Branch context (edit / regenerate / branch from a message): seed this
      // fresh run with prior turns as the agent's history. Consume-once, and
      // only on a NEW session (a continued session already has its own history).
      const branchHistory = useChatStore.getState().pendingBranchHistory;
      if (branchHistory) useChatStore.getState().setPendingBranchHistory(null);

      const body: RunInput = {
        input: runInput,
        ...(currentSessionId ? { session_id: currentSessionId } : {}),
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedProvider ? { provider: selectedProvider } : {}),
        ...(reasoningEffort !== null && reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
        ...(runProfile && runProfile !== "default" ? { profile: runProfile } : {}),
        ...(!currentSessionId && branchHistory && branchHistory.length > 0
          ? { conversation_history: branchHistory } : {}),
      };

      let runId: string;
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`POST /api/runs failed: ${res.status}`);
        const data = await res.json();
        runId = data.run_id;
        // Agents room: remember which agent this run belongs to so the streaming
        // assistant bubble (turn-<runId>-assistant) gets attributed.
        if (opts?.profileOverride) setAgentForRun(runId, opts.profileOverride);
      } catch (err) {
        appendMessage({
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Failed to start run: ${(err as Error).message}`,
          createdAt: Date.now(),
        });
        return;
      }

      if (!currentSessionId) {
        updateActiveSessionId(runId);
        // Remember the prompt as a title fallback until the run's auto-title is
        // persisted — keeps the row from flashing "Untitled" across the refetch
        // that lands a still-title-less DB row right after completion.
        useChatStore.getState().setProvisionalTitle(runId, input.trim().slice(0, 80));
        // Tag pre-session uploads so refresh can recover them via /api/upload/session/<run_id>.
        if (attachments) {
          const UPLOAD_RE = /^\/api\/upload\/([^/]+)\/[^/?#]+$/;
          for (const att of attachments) {
            if (!att.isImage) continue;
            const m = UPLOAD_RE.exec(att.content);
            if (!m) continue;
            api
              .json(`/api/upload/${m[1]}/meta`, "PATCH", { session_id: runId })
              .catch(() => {});
          }
        }
        // Optimistic sidebar prepend so the conversation appears before state.db commit.
        queryClient.setQueryData<{
          sessions: Array<{ session_id: string; title?: string; started_at?: number; updated_at?: number; source?: string }>;
        }>(["sessions-table-all"], (old) => {
          if (!old) return old;
          if (old.sessions.find((s) => s.session_id === runId)) return old;
          return {
            ...old,
            sessions: [
              // Title comes from the provisionalTitles fallback (set above) until
              // the auto-title lands — so it survives the post-completion refetch.
              { session_id: runId, started_at: Date.now() / 1000, updated_at: Date.now() / 1000 },
              ...old.sessions,
            ],
          };
        });
      }

      renameMessageId(tempUserId, `turn-${runId}-user`);
      // Track the run under its session so a switch-away/back can re-attach it.
      setRunningForSession(currentSessionId ?? runId, runId);
      setActiveRunId(runId);
      attachRun(runId);
    },
    [appendMessage, renameMessageId, setRunningForSession, updateActiveSessionId, queryClient,
      selectedModel, selectedProvider, reasoningEffort, setActiveRunId, attachRun, setAgentForRun]
  );

  const stopRun = useCallback(async () => {
    const { activeRunId, activeSessionId: sid } = useChatStore.getState();
    useChatStore.getState().setPendingApproval(null);
    if (!activeRunId) return;
    try {
      await fetch(`/api/runs/${encodeURIComponent(activeRunId)}/stop`, {
        method: "POST",
        headers: { "X-HMS-CSRF": "1" },
      });
    } catch { /* UI clears below regardless */ }
    // WS stop as belt-and-suspenders in case REST hit a stale run id.
    send({ type: "run.stop", run_id: activeRunId });
    setActiveRunId(null);
    setActiveTurn(null);
    if (sid) clearRunningForSession(sid);
    detach();
    const msgs = useChatStore.getState().messages;
    const last = msgs[msgs.length - 1];
    if (last?.streaming) {
      useChatStore.setState({
        messages: msgs.map((m) =>
          m.id === last.id ? { ...m, streaming: false } : m
        ),
      });
    }
  }, [send, setActiveRunId, setActiveTurn, clearRunningForSession, detach]);

  return { sendMessage, stopRun };
}
