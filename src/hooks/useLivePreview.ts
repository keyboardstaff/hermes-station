import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWSStore } from "@/store/ws";
import type { ChatMessage, ToolCall } from "@/lib/hermes-types";
import type { RunEventMessage } from "@/lib/ws-types";
import { shouldApplyFrame, toolCallId, mapToolStatus } from "@/lib/run-events";
import {
  emptyAccumulator, applyDelta, addTool, patchTool, buildLiveTurn,
  type LiveAccumulator,
} from "@/lib/live-preview";

interface ActiveRun {
  run_id: string;
  session_id: string;
  started_at: number;
  title: string;
}

/**
 * Live-streams the in-flight turn of a previewed session WITHOUT touching the
 * global chat store — so the `/sessions` preview drawer can mirror `/chat` in
 * real time while staying fully isolated from whatever session `/chat` owns.
 *
 * When the previewed session has an active run (server-truth `/api/runs/active`),
 * it seeds from `/api/runs/{id}/transcript` and subscribes to `run:<id>`,
 * accumulating deltas/reasoning/tools into local state. On completion it clears
 * the live turn and invalidates the preview/active queries so the now-persisted
 * turn reloads from the DB. Returns [] when the session isn't running.
 */
export function useLivePreview(sessionId: string | null): ChatMessage[] {
  const [live, setLive] = useState<ChatMessage[]>([]);
  const connect = useWSStore((s) => s.connect);
  const subscribe = useWSStore((s) => s.subscribe);
  const unsubscribe = useWSStore((s) => s.unsubscribe);
  const on = useWSStore((s) => s.on);
  const queryClient = useQueryClient();

  useEffect(() => { connect(); }, [connect]);

  // Server-truth in-flight runs (shares SessionRecents' cache). Polled so a run
  // that STARTS while the drawer is open is picked up too.
  const { data: activeData } = useQuery<{ runs: ActiveRun[] }>({
    queryKey: ["runs-active"],
    queryFn: async () => {
      const res = await fetch("/api/runs/active");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled: !!sessionId,
    retry: false,
    staleTime: 2_000,
    refetchInterval: 5_000,
  });
  const runId = sessionId
    ? activeData?.runs.find((r) => r.session_id === sessionId)?.run_id ?? null
    : null;

  useEffect(() => {
    if (!sessionId || !runId) {
      setLive([]);
      return;
    }
    let cancelled = false;
    let lastSeq = 0;
    const startedAt = Date.now();
    const channel = `run:${runId}`;
    const acc: LiveAccumulator = emptyAccumulator();
    const rebuild = () => { if (!cancelled) setLive(buildLiveTurn(runId, startedAt, acc)); };

    const off = on<RunEventMessage>("run.event", (msg) => {
      if (msg.run_id !== runId) return;
      const check = shouldApplyFrame(msg.seq, lastSeq);
      if (!check.apply) return;
      lastSeq = check.lastSeq;
      switch (msg.event) {
        case "message.delta":
          if (msg.delta) { acc.segments = applyDelta(acc.segments, msg.delta); rebuild(); }
          break;
        case "reasoning.available":
          if (msg.text) { acc.reasoning += msg.text; rebuild(); }
          break;
        case "tool.started": {
          if (!msg.tool) break;
          const tc: ToolCall = { id: toolCallId(runId, msg), toolName: msg.tool, preview: msg.preview, status: "running" };
          acc.segments = addTool(acc.segments, tc);
          rebuild();
          break;
        }
        case "tool.completed": {
          if (!msg.tool) break;
          acc.segments = patchTool(
            acc.segments,
            toolCallId(runId, msg),
            mapToolStatus(msg),
            typeof msg.duration === "number" ? msg.duration : undefined,
          );
          rebuild();
          break;
        }
        case "run.completed":
        case "run.failed":
        case "run.cancelled":
          // Run done → the turn is persisted now; drop the live mirror and let
          // the DB-backed preview query reload it.
          if (!cancelled) {
            setLive([]);
            queryClient.invalidateQueries({ queryKey: ["session-preview", sessionId] });
            queryClient.invalidateQueries({ queryKey: ["runs-active"] });
          }
          break;
      }
    });

    // Seed the partial BEFORE subscribing; the ring replay re-sends covered
    // frames but shouldApplyFrame (seeded from data.seq) dedups them.
    (async () => {
      try {
        const r = await fetch(`/api/runs/${encodeURIComponent(runId)}/transcript`);
        if (r.ok) {
          const data = (await r.json()) as {
            seq?: number;
            user_input?: string;
            partial?: {
              text?: string;
              reasoning?: string;
              tool_calls?: Array<{ tool_call_id: string; tool: string; preview?: string; status: ToolCall["status"] }>;
            };
          };
          if (cancelled) return;
          acc.userInput = data.user_input ?? "";
          const p = data.partial;
          if (p) {
            if (p.text) acc.segments = applyDelta(acc.segments, p.text);
            acc.reasoning = p.reasoning ?? "";
            for (const tc of p.tool_calls ?? []) {
              acc.segments = addTool(acc.segments, {
                id: tc.tool_call_id, toolName: tc.tool, preview: tc.preview, status: tc.status,
              });
            }
          }
          if (typeof data.seq === "number") lastSeq = data.seq;
          rebuild();
        }
      } catch { /* best-effort; ring replay reconstructs */ }
      if (!cancelled) subscribe(channel);
    })();

    return () => {
      cancelled = true;
      off();
      unsubscribe(channel);
    };
  }, [sessionId, runId, on, subscribe, unsubscribe, queryClient]);

  return live;
}
