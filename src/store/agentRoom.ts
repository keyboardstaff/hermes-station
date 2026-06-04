// Agents room — the roster of profile-agents you chat with, plus which one
// replies next. A "member" is a profile name; @mention routing sends a turn
// under that profile's HERMES_HOME (reuses the per-run profile override).
// Persisted to localStorage (owner-level, like pinned sessions / skins).

import { create } from "zustand";

const KEY = "hms_agent_room_members";

function readMembers(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
    }
  } catch { /* localStorage disabled / bad JSON */ }
  return [];
}

function writeMembers(members: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(members)); } catch { /* ignore */ }
}

interface AgentRoomStore {
  /** Profile names that are agents in the room. */
  members: string[];
  /** Which member replies to the next turn (null = none / default). */
  responder: string | null;
  addMember: (name: string) => void;
  removeMember: (name: string) => void;
  setResponder: (name: string | null) => void;
}

export const useAgentRoomStore = create<AgentRoomStore>((set, get) => {
  const members = readMembers();
  return {
    members,
    responder: members[0] ?? null,
    addMember: (name) => {
      const next = Array.from(new Set([...get().members, name]));
      writeMembers(next);
      set((s) => ({ members: next, responder: s.responder ?? name }));
    },
    removeMember: (name) => {
      const next = get().members.filter((m) => m !== name);
      writeMembers(next);
      set((s) => ({ members: next, responder: s.responder === name ? (next[0] ?? null) : s.responder }));
    },
    setResponder: (name) => set({ responder: name }),
  };
});
