// Agents rooms — multiple ISOLATED, persisted multi-agent conversations, each
// fully decoupled from /chat. A "member" is a profile name; each turn is routed
// under the @mentioned (or responder) member's HERMES_HOME via the per-run
// profile override, with the room's prior turns sent as conversation_history.
// All rooms persist to localStorage (owner-level, per browser). Hermes sessions
// can't back a room because profile-override runs persist into each profile's
// own state.db (they'd fragment a single session).

import { create } from "zustand";
import type { ChatMessage, MessageSegment, ToolCall } from "@/lib/hermes-types";

const ROOMS_KEY = "hms_agent_rooms";
const CUR_KEY = "hms_agent_current_room";
const MAX_PERSISTED = 80; // cap each room's stored transcript so localStorage can't overflow

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

export interface Room {
  id: string;
  name: string;
  members: string[];
  responder: string | null;
  messages: ChatMessage[];
  sessionIds: string[];
  activeRunId: string | null;
  activeTurnId: string | null;
  turnAgent: string | null;
}

function freshRoom(name: string): Room {
  return {
    id: `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    members: [],
    responder: null,
    messages: [],
    sessionIds: [],
    activeRunId: null,
    activeTurnId: null,
    turnAgent: null,
  };
}

function persist(rooms: Room[], currentRoomId: string): void {
  const trimmed = rooms.map((r) => ({
    ...r,
    messages: r.messages.slice(-MAX_PERSISTED).map((m) => ({ ...m, streaming: false })),
  }));
  writeJSON(ROOMS_KEY, trimmed);
  writeJSON(CUR_KEY, currentRoomId);
}

/** Load the rooms, migrating the legacy single-room keys on first run. */
function loadRooms(): { rooms: Room[]; currentRoomId: string } {
  const stored = readJSON<Room[] | null>(ROOMS_KEY, null);
  if (Array.isArray(stored) && stored.length > 0) {
    const cur = readJSON<string>(CUR_KEY, stored[0].id);
    return { rooms: stored, currentRoomId: stored.some((r) => r.id === cur) ? cur : stored[0].id };
  }
  // Migrate the old single-room keys into one room.
  const members = readJSON<string[]>("hms_agent_room_members", []);
  const messages = readJSON<ChatMessage[]>("hms_agent_room_messages", []);
  const responder = readJSON<string | null>("hms_agent_room_responder", null);
  const sessionIds = readJSON<string[]>("hms_agent_room_session_ids", []);
  const run = readJSON<{ runId: string | null; agent: string | null }>(
    "hms_agent_room_run",
    { runId: null, agent: null },
  );
  const room: Room = {
    ...freshRoom("Room 1"),
    members,
    messages,
    responder: responder ?? members[0] ?? null,
    sessionIds,
    activeRunId: run.runId,
    activeTurnId: run.runId,
    turnAgent: run.agent,
  };
  return { rooms: [room], currentRoomId: room.id };
}

const assistantTurnId = (turnId: string | null): string | null =>
  turnId ? `room-${turnId}-assistant` : null;

function findStreamIdx(msgs: ChatMessage[], turnId: string | null): number {
  const wantId = assistantTurnId(turnId);
  if (!wantId) return -1;
  return msgs.findIndex((m) => m.id === wantId);
}

interface AgentRoomStore {
  rooms: Room[];
  currentRoomId: string;
  /** Internal: the room the in-flight run streams into — stays fixed if the
   *  user switches rooms mid-run, so frames never bleed into another room. */
  _streamRoomId: string | null;

  // ── Room management ──
  createRoom: (name?: string) => void;
  deleteRoom: (id: string) => void;
  renameRoom: (id: string, name: string) => void;
  selectRoom: (id: string) => void;

  // ── Current-room roster ──
  addMember: (name: string) => void;
  removeMember: (name: string) => void;
  setResponder: (name: string | null) => void;

  // ── Current-room conversation ──
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

/** The active room (always present — the store guarantees ≥ 1 room). */
export function currentRoom(s: { rooms: Room[]; currentRoomId: string }): Room {
  return s.rooms.find((r) => r.id === s.currentRoomId) ?? s.rooms[0];
}

export const useAgentRoomStore = create<AgentRoomStore>((set) => {
  const { rooms, currentRoomId } = loadRooms();

  /** Update the current room; `save` persists (skip it on per-token deltas). */
  const patch = (fn: (r: Room) => Partial<Room>, save: boolean) =>
    set((s) => {
      const next = s.rooms.map((r) => (r.id === s.currentRoomId ? { ...r, ...fn(r) } : r));
      if (save) persist(next, s.currentRoomId);
      return { rooms: next };
    });

  /** Update the room the in-flight run belongs to (the stream target), so a
   *  mid-run room switch can't redirect frames to the wrong room. */
  const patchStream = (fn: (r: Room) => Partial<Room>, save: boolean) =>
    set((s) => {
      const targetId = s._streamRoomId ?? s.currentRoomId;
      const next = s.rooms.map((r) => (r.id === targetId ? { ...r, ...fn(r) } : r));
      if (save) persist(next, s.currentRoomId);
      return { rooms: next };
    });

  return {
    rooms,
    currentRoomId,
    _streamRoomId: null,

    createRoom: (name) =>
      set((s) => {
        const room = freshRoom(name?.trim() || `Room ${s.rooms.length + 1}`);
        const next = [...s.rooms, room];
        persist(next, room.id);
        return { rooms: next, currentRoomId: room.id };
      }),
    deleteRoom: (id) =>
      set((s) => {
        const remaining = s.rooms.filter((r) => r.id !== id);
        const rooms = remaining.length > 0 ? remaining : [freshRoom("Room 1")];
        const currentRoomId = rooms.some((r) => r.id === s.currentRoomId) ? s.currentRoomId : rooms[0].id;
        persist(rooms, currentRoomId);
        return { rooms, currentRoomId };
      }),
    renameRoom: (id, name) =>
      set((s) => {
        const rooms = s.rooms.map((r) => (r.id === id ? { ...r, name: name.trim() || r.name } : r));
        persist(rooms, s.currentRoomId);
        return { rooms };
      }),
    selectRoom: (id) =>
      set((s) => {
        if (!s.rooms.some((r) => r.id === id)) return {};
        writeJSON(CUR_KEY, id);
        return { currentRoomId: id };
      }),

    addMember: (name) =>
      patch((r) => {
        const members = Array.from(new Set([...r.members, name]));
        return { members, responder: r.responder ?? name };
      }, true),
    removeMember: (name) =>
      patch((r) => {
        const members = r.members.filter((m) => m !== name);
        return { members, responder: r.responder === name ? (members[0] ?? null) : r.responder };
      }, true),
    setResponder: (name) => patch(() => ({ responder: name }), true),

    appendUser: (text, agent, attachments) =>
      patch((r) => ({
        messages: [
          ...r.messages,
          {
            id: `room-user-${Date.now()}`,
            role: "user" as const,
            content: text,
            agent,
            ...(attachments && attachments.length ? { attachments } : {}),
            createdAt: Date.now(),
          },
        ],
      }), true),

    appendDelta: (delta) =>
      patchStream((r) => {
        const msgs = [...r.messages];
        const idx = findStreamIdx(msgs, r.activeTurnId);
        if (idx === -1) {
          msgs.push({
            id: assistantTurnId(r.activeTurnId) ?? `room-stream-${Date.now()}`,
            role: "assistant",
            content: "",
            segments: [{ type: "text", content: delta }],
            ...(r.turnAgent ? { agent: r.turnAgent } : {}),
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
      }, false),

    appendReasoning: (text) =>
      patchStream((r) => {
        const msgs = [...r.messages];
        const idx = findStreamIdx(msgs, r.activeTurnId);
        if (idx === -1) {
          msgs.push({
            id: assistantTurnId(r.activeTurnId) ?? `room-stream-${Date.now()}`,
            role: "assistant",
            content: "",
            segments: [],
            reasoning: text,
            ...(r.turnAgent ? { agent: r.turnAgent } : {}),
            createdAt: Date.now(),
            streaming: true,
          });
          return { messages: msgs };
        }
        const target = msgs[idx];
        msgs[idx] = { ...target, reasoning: (target.reasoning ?? "") + text };
        return { messages: msgs };
      }, false),

    appendToolCallPart: (tc) =>
      patchStream((r) => {
        const msgs = [...r.messages];
        const idx = findStreamIdx(msgs, r.activeTurnId);
        const seg: MessageSegment = { type: "tool", tc };
        if (idx === -1) {
          msgs.push({
            id: assistantTurnId(r.activeTurnId) ?? `room-run-${tc.id}`,
            role: "assistant",
            content: "",
            segments: [seg],
            ...(r.turnAgent ? { agent: r.turnAgent } : {}),
            createdAt: Date.now(),
            streaming: true,
          });
        } else {
          const target = msgs[idx];
          msgs[idx] = { ...target, segments: [...(target.segments ?? []), seg] };
        }
        return { messages: msgs };
      }, false),

    upsertToolCall: (tc) =>
      patchStream((r) => ({
        messages: r.messages.map((m) => {
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
        }),
      }), false),

    setFinalContent: (text) =>
      patchStream((r) => {
        const msgs = [...r.messages];
        const idx = findStreamIdx(msgs, r.activeTurnId);
        if (idx === -1) {
          msgs.push({
            id: assistantTurnId(r.activeTurnId) ?? `room-final-${Date.now()}`,
            role: "assistant",
            content: text,
            segments: [{ type: "text", content: text }],
            ...(r.turnAgent ? { agent: r.turnAgent } : {}),
            createdAt: Date.now(),
          });
        } else {
          const target = msgs[idx];
          const toolSegs = (target.segments ?? []).filter((seg) => seg.type === "tool");
          msgs[idx] = { ...target, content: text, segments: [...toolSegs, { type: "text", content: text }] };
        }
        return { messages: msgs };
      }, false),

    beginTurn: (runId, agent) =>
      set((s) => {
        const next = s.rooms.map((r) =>
          r.id === s.currentRoomId
            ? { ...r, activeRunId: runId, activeTurnId: runId, turnAgent: agent }
            : r,
        );
        persist(next, s.currentRoomId);
        return { rooms: next, _streamRoomId: s.currentRoomId };
      }),

    finishTurn: () =>
      set((s) => {
        const targetId = s._streamRoomId ?? s.currentRoomId;
        const next = s.rooms.map((r) =>
          r.id === targetId
            ? {
                ...r,
                messages: r.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
                activeRunId: null,
                activeTurnId: null,
                turnAgent: null,
              }
            : r,
        );
        persist(next, s.currentRoomId);
        return { rooms: next, _streamRoomId: null };
      }),

    addSessionId: (id) =>
      patchStream((r) => (r.sessionIds.includes(id) ? {} : { sessionIds: [...r.sessionIds, id] }), true),

    clearConversation: () =>
      patch(() => ({ messages: [], sessionIds: [], activeRunId: null, activeTurnId: null, turnAgent: null }), true),
  };
});
