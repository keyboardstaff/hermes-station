import { useCallback, useRef } from "react";
import { useWSStore } from "@/store/ws";
import { useAgentRoomStore } from "@/store/agentRoom";
import { messagePlainText } from "@/lib/branch";
import { shouldApplyFrame, toolCallId, mapToolStatus } from "@/lib/run-events";
import type { RunEventMessage } from "@/lib/ws-types";

/** Parse a leading `@member` route from the draft. Returns the matched agent
 *  (or null) and the body with the mention stripped. */
export function parseMention(
  text: string,
  members: string[],
): { agent: string | null; body: string } {
  const m = text.match(/^@(\S+)\s*/);
  if (m && members.includes(m[1])) {
    return { agent: m[1], body: text.slice(m[0].length) };
  }
  return { agent: null, body: text };
}

/**
 * Agents-room run lifecycle — the room's OWN streaming, isolated from /chat.
 * Each turn POSTs /api/runs under the routed member's `profile` (HERMES_HOME)
 * with the room's prior turns as `conversation_history` (no `session_id` — the
 * room owns its transcript), then mirrors run frames into the agentRoom store.
 */
export function useAgentRoomStream() {
  const subscribe = useWSStore((s) => s.subscribe);
  const unsubscribe = useWSStore((s) => s.unsubscribe);
  const on = useWSStore((s) => s.on);
  const offRef = useRef<(() => void) | null>(null);
  const channelRef = useRef<string | null>(null);
  const seqRef = useRef(0);

  const detach = useCallback(() => {
    offRef.current?.();
    offRef.current = null;
    if (channelRef.current) {
      unsubscribe(channelRef.current);
      channelRef.current = null;
    }
  }, [unsubscribe]);

  const send = useCallback(
    async (text: string) => {
      const room = useAgentRoomStore.getState();
      if (room.activeRunId) return; // one turn at a time in the MVP room
      const { agent: mentioned, body } = parseMention(text.trim(), room.members);
      const agent = mentioned ?? room.responder ?? room.members[0] ?? null;
      if (!agent || !body.trim()) return;

      // Context = the room's completed turns (before this one).
      const history = room.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: messagePlainText(m) }))
        .filter((tn) => tn.content.trim().length > 0);

      room.appendUser(body, agent);

      let runId: string;
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
          body: JSON.stringify({ input: body, profile: agent, conversation_history: history }),
        });
        if (!res.ok) throw new Error(String(res.status));
        runId = (await res.json()).run_id;
      } catch {
        const rs = useAgentRoomStore.getState();
        rs.beginTurn(`err-${Date.now()}`, agent);
        rs.setFinalContent("⚠ Failed to start the run.");
        rs.finishTurn();
        return;
      }

      useAgentRoomStore.getState().beginTurn(runId, agent);
      detach();
      seqRef.current = 0;
      const channel = `run:${runId}`;
      channelRef.current = channel;

      const off = on<RunEventMessage>("run.event", (msg) => {
        if (msg.run_id !== runId) return;
        const seqCheck = shouldApplyFrame(msg.seq, seqRef.current);
        if (!seqCheck.apply) return;
        seqRef.current = seqCheck.lastSeq;
        const rs = useAgentRoomStore.getState();
        switch (msg.event) {
          case "message.delta":
            if (msg.delta) rs.appendDelta(msg.delta);
            break;
          case "reasoning.available":
            if (msg.text) rs.appendReasoning(msg.text);
            break;
          case "tool.started":
            if (msg.tool) {
              rs.appendToolCallPart({
                id: toolCallId(runId, msg),
                toolName: msg.tool,
                preview: msg.preview,
                status: "running",
              });
            }
            break;
          case "tool.completed":
            if (msg.tool) {
              rs.upsertToolCall({
                id: toolCallId(runId, msg),
                toolName: msg.tool,
                duration: typeof msg.duration === "number" ? msg.duration : undefined,
                status: mapToolStatus(msg),
              });
            }
            break;
          case "run.completed":
          case "run.failed":
          case "run.cancelled":
            if (msg.event === "run.completed" && msg.output) rs.setFinalContent(msg.output);
            rs.finishTurn();
            detach();
            break;
        }
      });
      offRef.current = off;
      subscribe(channel);
    },
    [on, subscribe, detach],
  );

  const stop = useCallback(async () => {
    const runId = useAgentRoomStore.getState().activeRunId;
    if (!runId) return;
    try {
      await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, {
        method: "POST",
        headers: { "X-HMS-CSRF": "1" },
      });
    } catch { /* best-effort */ }
  }, []);

  return { send, stop };
}
