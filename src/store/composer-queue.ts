import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ComposerAttachment } from "@/lib/hermes-types";

/**
 * Per-session composer queue — mirrors upstream desktop's `composer-queue`
 * store: messages sent while a run is streaming are queued (persisted across
 * refreshes) and auto-drained head-first whenever the session settles
 * (busy true → false), whether the turn finished naturally or was
 * interrupted. Send-now on a queued entry promotes it to the head (and the
 * caller interrupts the live run, letting the settle drain deliver it).
 */

export interface QueuedPromptEntry {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
  queuedAt: number;
}

interface ComposerQueueState {
  queuesBySession: Record<string, QueuedPromptEntry[]>;
  enqueue: (sessionKey: string | null | undefined, payload: { text: string; attachments?: ComposerAttachment[] }) => QueuedPromptEntry | null;
  remove: (sessionKey: string | null | undefined, id: string) => boolean;
  /** Move an entry to the head so the next drain sends it. */
  promote: (sessionKey: string | null | undefined, id: string) => boolean;
  updateText: (sessionKey: string | null | undefined, id: string, text: string) => boolean;
  clear: (sessionKey: string | null | undefined) => void;
}

function sidOf(key: string | null | undefined): string | null {
  const trimmed = key?.trim();
  return trimmed ? trimmed : null;
}

function nextId(): string {
  return `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeSession(
  state: Record<string, QueuedPromptEntry[]>,
  sid: string,
  queue: QueuedPromptEntry[],
): Record<string, QueuedPromptEntry[]> {
  const next = { ...state };
  if (queue.length === 0) delete next[sid];
  else next[sid] = queue;
  return next;
}

export const useComposerQueue = create<ComposerQueueState>()(
  persist(
    (set, get) => ({
      queuesBySession: {},

      enqueue: (key, payload) => {
        const sid = sidOf(key);
        if (!sid) return null;
        const entry: QueuedPromptEntry = {
          id: nextId(),
          text: payload.text,
          attachments: (payload.attachments ?? []).map((a) => ({ ...a })),
          queuedAt: Date.now(),
        };
        set((s) => ({
          queuesBySession: writeSession(
            s.queuesBySession, sid, [...(s.queuesBySession[sid] ?? []), entry],
          ),
        }));
        return entry;
      },

      remove: (key, id) => {
        const sid = sidOf(key);
        if (!sid) return false;
        const queue = get().queuesBySession[sid] ?? [];
        const next = queue.filter((e) => e.id !== id);
        if (next.length === queue.length) return false;
        set((s) => ({ queuesBySession: writeSession(s.queuesBySession, sid, next) }));
        return true;
      },

      promote: (key, id) => {
        const sid = sidOf(key);
        if (!sid) return false;
        const queue = get().queuesBySession[sid] ?? [];
        const index = queue.findIndex((e) => e.id === id);
        if (index <= 0) return false;
        const entry = queue[index];
        const next = [entry, ...queue.slice(0, index), ...queue.slice(index + 1)];
        set((s) => ({ queuesBySession: writeSession(s.queuesBySession, sid, next) }));
        return true;
      },

      updateText: (key, id, text) => {
        const sid = sidOf(key);
        if (!sid) return false;
        const queue = get().queuesBySession[sid] ?? [];
        let changed = false;
        const next = queue.map((e) => {
          if (e.id !== id || e.text === text) return e;
          changed = true;
          return { ...e, text };
        });
        if (!changed) return false;
        set((s) => ({ queuesBySession: writeSession(s.queuesBySession, sid, next) }));
        return true;
      },

      clear: (key) => {
        const sid = sidOf(key);
        if (!sid || !(sid in get().queuesBySession)) return;
        set((s) => ({ queuesBySession: writeSession(s.queuesBySession, sid, []) }));
      },
    }),
    { name: "hms-composer-queue" },
  ),
);

/** Read a session's queue (empty when no session). */
export function queuedPromptsFor(
  state: Record<string, QueuedPromptEntry[]>,
  key: string | null | undefined,
): QueuedPromptEntry[] {
  const sid = sidOf(key);
  return sid ? state[sid] ?? [] : [];
}

/** Inputs to {@link shouldAutoDrainOnSettle}, captured at a busy transition. */
export interface AutoDrainSettleInput {
  wasBusy: boolean;
  isBusy: boolean;
  queueLength: number;
}

/**
 * Decide whether to auto-drain the next queued prompt when a turn settles
 * (busy transitions true → false). Queued turns always advance once the
 * session is idle again — whether the turn finished naturally or the user
 * interrupted it (interrupting to reach a queued message is the point of the
 * queue). To cancel queued turns the user deletes them from the panel.
 */
export function shouldAutoDrainOnSettle({ wasBusy, isBusy, queueLength }: AutoDrainSettleInput): boolean {
  if (isBusy || !wasBusy) return false;
  return queueLength > 0;
}
