import { useCallback, useEffect, useRef } from "react";
import { useWSStore } from "@/store/ws";
import { useChatStore } from "@/store/chat";
import { useAgentRoomStore, currentRoom } from "@/store/agentRoom";
import { messagePlainText } from "@/lib/branch";
import { shouldApplyFrame, toolCallId, mapToolStatus } from "@/lib/run-events";
import type { RunEventMessage } from "@/lib/ws-types";
import type { ComposerAttachment, ContentPart } from "@/lib/hermes-types";

/** All `@member` tokens (in order, deduped) anywhere in the draft, plus the
 *  body with those routing mentions removed. Drives multi-agent fan-out: every
 *  mentioned member answers in turn. */
export function parseMentions(
  text: string,
  members: string[],
): { agents: string[]; body: string } {
  const agents: string[] = [];
  const body = text
    .replace(/(?:^|\s)@([\w-]+)/g, (full: string, name: string) => {
      if (members.includes(name)) {
        if (!agents.includes(name)) agents.push(name);
        return " "; // strip every member mention (even repeats)
      }
      return full;
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return { agents, body };
}

/**
 * Agents-room run lifecycle — the room's OWN streaming, isolated from /chat.
 * Each user message fans out to every @mentioned member sequentially (each sees
 * the prior replies via conversation_history); a refresh mid-run re-attaches to
 * the live run so the streaming reply isn't lost.
 */
export function useAgentRoomStream() {
  const subscribe = useWSStore((s) => s.subscribe);
  const unsubscribe = useWSStore((s) => s.unsubscribe);
  const on = useWSStore((s) => s.on);
  const connect = useWSStore((s) => s.connect);
  const offRef = useRef<(() => void) | null>(null);
  const channelRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const queueRef = useRef<{ agents: string[]; body: string; attachments?: ComposerAttachment[] }>({
    agents: [],
    body: "",
  });
  const resumedRef = useRef(false);

  // The WS is otherwise only connected by /chat + /sessions; a direct landing
  // on /agents needs its own connect so room runs actually stream back.
  useEffect(() => { connect(); }, [connect]);

  const detach = useCallback(() => {
    offRef.current?.();
    offRef.current = null;
    if (channelRef.current) {
      unsubscribe(channelRef.current);
      channelRef.current = null;
    }
  }, [unsubscribe]);

  /** Subscribe to a run and mirror its frames into the room store; `onDone`
   *  fires on the terminal frame (used to chain the next queued agent). */
  const attach = useCallback(
    (runId: string, onDone: () => void) => {
      detach();
      seqRef.current = 0;
      const channel = `run:${runId}`;
      channelRef.current = channel;
      const off = on<RunEventMessage>("run.event", (msg) => {
        if (msg.run_id !== runId) return;
        const sc = shouldApplyFrame(msg.seq, seqRef.current);
        if (!sc.apply) return;
        seqRef.current = sc.lastSeq;
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
            onDone();
            break;
        }
      });
      offRef.current = off;
      subscribe(channel);
    },
    [on, subscribe, detach],
  );

  /** Start the next queued agent's run; chains to the following one on done. */
  const runNext = useCallback(async () => {
    const agent = queueRef.current.agents.shift();
    if (!agent) return;
    const { body, attachments } = queueRef.current;

    const history = currentRoom(useAgentRoomStore.getState()).messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: messagePlainText(m) }))
      .filter((tn) => tn.content.trim().length > 0);

    let runInput: string | ContentPart[] = body;
    if (attachments && attachments.length > 0) {
      const parts: ContentPart[] = [{ type: "text", text: body }];
      for (const att of attachments) {
        if (att.isImage) parts.push({ type: "image_url", image_url: { url: att.content } });
        else parts.push({ type: "text", text: `\`\`\`${att.name}\n${att.content}\n\`\`\`` });
      }
      runInput = parts;
    }

    const chat = useChatStore.getState();
    let runId: string;
    let errText = "⚠ Failed to start the run.";
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
        body: JSON.stringify({
          input: runInput,
          conversation_history: history,
          ...(agent !== "default" ? { profile: agent } : {}),
          ...(chat.selectedModel ? { model: chat.selectedModel } : {}),
          ...(chat.selectedProvider ? { provider: chat.selectedProvider } : {}),
          ...(chat.reasoningEffort != null ? { reasoning_effort: chat.reasoningEffort } : {}),
        }),
      });
      if (!res.ok) {
        try {
          const eb = await res.json();
          if (typeof eb?.detail === "string") errText = "⚠ " + eb.detail;
        } catch { /* non-JSON */ }
        throw new Error("bad status");
      }
      runId = (await res.json()).run_id;
    } catch {
      const rs = useAgentRoomStore.getState();
      rs.beginTurn(`err-${Date.now()}`, agent);
      rs.setFinalContent(errText);
      rs.finishTurn();
      void runNext(); // still try the remaining mentioned agents
      return;
    }

    const rs = useAgentRoomStore.getState();
    rs.addSessionId(runId); // session_id === run_id (no session) — hide from /chat Recents
    rs.beginTurn(runId, agent);
    attach(runId, () => { void runNext(); });
  }, [attach]);

  const send = useCallback(
    async (text: string, attachments?: ComposerAttachment[]) => {
      const s = useAgentRoomStore.getState();
      const cur = currentRoom(s);
      if (cur.activeRunId) return; // one fan-out at a time per room
      const { agents, body } = parseMentions(text.trim(), cur.members);
      const routed =
        agents.length > 0
          ? agents
          : cur.responder
            ? [cur.responder]
            : cur.members.slice(0, 1);
      const hasAttach = !!attachments && attachments.length > 0;
      if (routed.length === 0 || (!body.trim() && !hasAttach)) return;

      s.appendUser(body, routed.join(", "));
      queueRef.current = { agents: [...routed], body, attachments };
      void runNext();
    },
    [runNext],
  );

  // Resume a run that was in flight when the page refreshed: re-attach to a live
  // run (the WS ring replays the partial) or land the final of one that finished.
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    const { activeRunId, turnAgent } = currentRoom(useAgentRoomStore.getState());
    if (!activeRunId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/runs/${encodeURIComponent(activeRunId)}`);
        if (res.status === 404) { useAgentRoomStore.getState().finishTurn(); return; }
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "running" || data.status === "queued") {
          useAgentRoomStore.getState().beginTurn(activeRunId, turnAgent ?? "");
          attach(activeRunId, () => { /* queue not restored across refresh */ });
        } else {
          if (typeof data.output === "string" && data.output) {
            useAgentRoomStore.getState().setFinalContent(data.output);
          }
          useAgentRoomStore.getState().finishTurn();
        }
      } catch {
        useAgentRoomStore.getState().finishTurn();
      }
    })();
  }, [attach]);

  const stop = useCallback(async () => {
    queueRef.current.agents = []; // stop chaining to the remaining agents too
    const runId = currentRoom(useAgentRoomStore.getState()).activeRunId;
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
