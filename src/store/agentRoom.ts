// Agents room — an ISOLATED, persisted multi-agent conversation, fully
// decoupled from the /chat store. A "member" is a profile name; each turn is
// routed under the @mentioned (or responder) member's HERMES_HOME via the
// per-run profile override, with the room's prior turns sent as
// `conversation_history` for context. The transcript + roster persist to
// localStorage (owner-level, per browser) so the room survives a reload —
// hermes sessions can't back it because profile-override runs persist into each
// profile's own state.db (they'd fragment a single session).

import { create } from "zustand";
import type { ChatMessage, MessageSegment, ToolCall } from "@/lib/hermes-types";

const MEMBERS_KEY = "hms_agent_room_members";
const RESPONDER_KEY = "hms_agent_room_responder";
const MSGS_KEY = "hms_agent_room_messages";
const SIDS_KEY = "hms_agent_room_session_ids";
const MAX_PERSISTED = 80; // cap the stored transcript so localStorage can't overflow

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* localStorage disabled / bad JSON */ }
  return fallback;
}

function writeJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / disabled */ }
}

function readMembers(): string[] {
  const arr = readJSON<unknown>(MEMBERS_KEY, []);
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
}

function persistMessages(messages: ChatMessage[]): void {
  // Strip streaming flags + cap before persisting; keep it text/segment-shaped.
  const tail = messages.slice(-MAX_PERSISTED).map((m) => ({ ...m, streaming: false }));
  writeJSON(MSGS_KEY, tail);
}

const assistantTurnId = (turnId: string | null): string | null =>
  turnId ? `room-${turnId}-assistant` : null;

function findStreamIdx(msgs: ChatMessage[], turnId: string | null): number {
  const wantId = assistantTurnId(turnId);
  if (!wantId) return -1;
  return msgs.findIndex((m) => m.id === wantId);
}

interface AgentRoomStore {
  /** Profile names that are agents in the room. */
  members: string[];
  /** Which member replies when no explicit @mention is given. */
  responder: string | null;
  /** The room's own transcript (isolated from /chat). */
  messages: ChatMessage[];
  activeRunId: string | null;
  activeTurnId: string | null;
  /** The agent the in-flight turn is routed to (stamps the assistant bubble). */
  turnAgent: string | null;
  /** Hermes session ids the room's runs created — hidden from /chat Recents. */
  sessionIds: string[];

  addMember: (name: string) => void;
  removeMember: (name: string) => void;
  setResponder: (name: string | null) => void;

  /** Append the user's message, tagged with the agent it's routed to. */
  appendUser: (text: string, agent: string, attachments?: ChatMessage["attachments"]) => void;
  appendDelta: (delta: string) => void;
  appendReasoning: (text: string) => void;
  appendToolCallPart: (tc: ToolCall) => void;
  upsertToolCall: (tc: Pick<ToolCall, "id"> & Partial<ToolCall>) => void;
  setFinalContent: (text: string) => void;
  beginTurn: (runId: string, agent: string) => void;
  finishTurn: () => void;
  addSessionId: (id: string) => void;
  clearConversation: () => void;
}

export const useAgentRoomStore = create<AgentRoomStore>((set, get) => ({
  members: readMembers(),
  responder: readJSON<string | null>(RESPONDER_KEY, null) ?? readMembers()[0] ?? null,
  messages: readJSON<ChatMessage[]>(MSGS_KEY, []),
  activeRunId: null,
  activeTurnId: null,
  turnAgent: null,
  sessionIds: readJSON<string[]>(SIDS_KEY, []),

  addMember: (name) => {
    const next = Array.from(new Set([...get().members, name]));
    writeJSON(MEMBERS_KEY, next);
    set((s) => {
      const responder = s.responder ?? name;
      writeJSON(RESPONDER_KEY, responder);
      return { members: next, responder };
    });
  },
  removeMember: (name) => {
    const next = get().members.filter((m) => m !== name);
    writeJSON(MEMBERS_KEY, next);
    set((s) => {
      const responder = s.responder === name ? (next[0] ?? null) : s.responder;
      writeJSON(RESPONDER_KEY, responder);
      return { members: next, responder };
    });
  },
  setResponder: (name) => {
    writeJSON(RESPONDER_KEY, name);
    set({ responder: name });
  },

  appendUser: (text, agent, attachments) =>
    set((s) => {
      const messages = [
        ...s.messages,
        {
          id: `room-user-${Date.now()}`,
          role: "user" as const,
          content: text,
          agent,
          ...(attachments && attachments.length ? { attachments } : {}),
          createdAt: Date.now(),
        },
      ];
      persistMessages(messages);
      return { messages };
    }),

  appendDelta: (delta) =>
    set((s) => {
      const msgs = [...s.messages];
      const idx = findStreamIdx(msgs, s.activeTurnId);
      if (idx === -1) {
        msgs.push({
          id: assistantTurnId(s.activeTurnId) ?? `room-stream-${Date.now()}`,
          role: "assistant",
          content: "",
          segments: [{ type: "text", content: delta }],
          ...(s.turnAgent ? { agent: s.turnAgent } : {}),
          createdAt: Date.now(),
          streaming: true,
        });
        return { messages: msgs };
      }
      const target = msgs[idx];
      const segs = target.segments ?? [];
      const last = segs[segs.length - 1];
      const newSegs: MessageSegment[] =
        last && last.type === "text"
          ? [...segs.slice(0, -1), { type: "text", content: last.content + delta }]
          : [...segs, { type: "text", content: delta }];
      msgs[idx] = { ...target, segments: newSegs };
      return { messages: msgs };
    }),

  appendReasoning: (text) =>
    set((s) => {
      const msgs = [...s.messages];
      const idx = findStreamIdx(msgs, s.activeTurnId);
      if (idx === -1) {
        msgs.push({
          id: assistantTurnId(s.activeTurnId) ?? `room-stream-${Date.now()}`,
          role: "assistant",
          content: "",
          segments: [],
          reasoning: text,
          ...(s.turnAgent ? { agent: s.turnAgent } : {}),
          createdAt: Date.now(),
          streaming: true,
        });
        return { messages: msgs };
      }
      const target = msgs[idx];
      msgs[idx] = { ...target, reasoning: (target.reasoning ?? "") + text };
      return { messages: msgs };
    }),

  appendToolCallPart: (tc) =>
    set((s) => {
      const msgs = [...s.messages];
      const idx = findStreamIdx(msgs, s.activeTurnId);
      const seg: MessageSegment = { type: "tool", tc };
      if (idx === -1) {
        msgs.push({
          id: assistantTurnId(s.activeTurnId) ?? `room-run-${tc.id}`,
          role: "assistant",
          content: "",
          segments: [seg],
          ...(s.turnAgent ? { agent: s.turnAgent } : {}),
          createdAt: Date.now(),
          streaming: true,
        });
      } else {
        const target = msgs[idx];
        msgs[idx] = { ...target, segments: [...(target.segments ?? []), seg] };
      }
      return { messages: msgs };
    }),

  upsertToolCall: (tc) =>
    set((s) => {
      const msgs = s.messages.map((m) => {
        if (!m.segments) return m;
        let touched = false;
        const segments = m.segments.map((seg) => {
          if (seg.type === "tool" && seg.tc.id === tc.id) {
            touched = true;
            return { ...seg, tc: { ...seg.tc, ...tc } };
          }
          return seg;
        });
        return touched ? { ...m, segments } : m;
      });
      return { messages: msgs };
    }),

  setFinalContent: (text) =>
    set((s) => {
      const msgs = [...s.messages];
      const idx = findStreamIdx(msgs, s.activeTurnId);
      if (idx === -1) {
        msgs.push({
          id: assistantTurnId(s.activeTurnId) ?? `room-final-${Date.now()}`,
          role: "assistant",
          content: text,
          segments: [{ type: "text", content: text }],
          ...(s.turnAgent ? { agent: s.turnAgent } : {}),
          createdAt: Date.now(),
        });
      } else {
        // Replace the streamed text segment(s) with the authoritative final text,
        // preserving any tool segments in order.
        const target = msgs[idx];
        const toolSegs = (target.segments ?? []).filter((seg) => seg.type === "tool");
        msgs[idx] = {
          ...target,
          content: text,
          segments: [...toolSegs, { type: "text", content: text }],
        };
      }
      return { messages: msgs };
    }),

  beginTurn: (runId, agent) => set({ activeRunId: runId, activeTurnId: runId, turnAgent: agent }),

  addSessionId: (id) =>
    set((s) => {
      if (s.sessionIds.includes(id)) return {};
      const sessionIds = [...s.sessionIds, id];
      writeJSON(SIDS_KEY, sessionIds);
      return { sessionIds };
    }),

  finishTurn: () =>
    set((s) => {
      const messages = s.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m));
      persistMessages(messages);
      return { messages, activeRunId: null, activeTurnId: null, turnAgent: null };
    }),

  clearConversation: () => {
    writeJSON(MSGS_KEY, []);
    writeJSON(SIDS_KEY, []);
    set({ messages: [], activeRunId: null, activeTurnId: null, turnAgent: null, sessionIds: [] });
  },
}));
