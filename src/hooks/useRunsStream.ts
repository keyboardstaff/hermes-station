import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useChatStore } from "@/store/chat";
import { useWSStore } from "@/store/ws";
import type { ComposerAttachment, ContentPart, RunInput } from "@/lib/hermes-types";
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

  useEffect(() => { connect(); }, [connect]);

  const detach = useCallback(() => {
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
    const currentRun = useChatStore.getState().activeRunId;
    if (currentRun && currentRun === activeSessionId) return;

    // Tear down the previous session's live subscription.
    detach();
    setActiveRunId(null);
    setActiveTurn(null);

    if (!activeSessionId) return;
    const runId = useChatStore.getState().runningBySession[activeSessionId];
    if (!runId) return;

    // Re-attach only if the server still considers the run live.
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
      // All streaming events target turn-<runId>-assistant; set before any frame lands.
      setActiveTurn(runId);
      lastSeqRef.current = 0;
      const channel = `run:${runId}`;
      subscribe(channel);
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
            queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });
            // LLM title generation lands a few seconds after completion.
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });
            }, 6000);

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

      return offRunEvent;
    },
    [appendDelta, appendReasoning, appendToolCallPart, upsertToolCall,
      patchToolResultsById, setFinalContent, setActiveTurn, setActiveRunId,
      clearRunningForSession, queryClient, subscribe, on, detach]
  );

  // Resume persisted run on mount: re-subscribe and let server replay from last_seq.
  useEffect(() => {
    const persistedRunId = useChatStore.getState().activeRunId;
    if (!persistedRunId) return;
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
    async (input: string, attachments?: ComposerAttachment[]) => {
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
      // that profile's HERMES_HOME in-process, no restart (owner review D17).
      // Omit "default" — that's the process home already.
      const activeProfile = queryClient.getQueryData<{ sticky?: string }>(["profile-active"])?.sticky;

      const body: RunInput = {
        input: runInput,
        ...(currentSessionId ? { session_id: currentSessionId } : {}),
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedProvider ? { provider: selectedProvider } : {}),
        ...(reasoningEffort !== null && reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
        ...(activeProfile && activeProfile !== "default" ? { profile: activeProfile } : {}),
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
      selectedModel, selectedProvider, reasoningEffort, setActiveRunId, attachRun]
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
