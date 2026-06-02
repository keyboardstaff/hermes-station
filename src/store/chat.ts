import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage, MessageSegment, PendingApproval, ToolCall } from "@/lib/hermes-types";

interface ChatState {
  activeSessionId: string | null;
  /** Set atomically with messages[] clear so there's never a "blank" render. */
  isHistoryPending: boolean;
  messages: ChatMessage[];
  activeRunId: string | null;
  /** Live-only: the run_id whose streaming events target `turn-<id>-assistant`.
   *  Reconstructed from activeRunId on resume; never persisted. */
  activeTurnId: string | null;
  /** session_id → run_id for runs still in flight. Lets a session switch (or a
   *  refresh) re-attach the right run instead of orphaning it. Persisted; stale
   *  entries are pruned lazily when a re-attach finds the run already gone. */
  runningBySession: Record<string, string>;
  selectedModel: string | null;
  selectedProvider: string | null;
  /** Matches hermes_constants.VALID_REASONING_EFFORTS; null = use config.yaml default. */
  reasoningEffort: string | null;
  /** Client-side display preference (upstream /reasoning show|hide) — controls
   *  whether the assistant's chain-of-thought renders in the transcript. */
  showReasoning: boolean;
  /** Composer context-ring: show the numeric token label (the /usage toggle). */
  showTokens: boolean;
  /** Cumulative session token usage from the last run.completed — feeds the
   *  Composer context ring. Reset on session switch / clear. */
  lastUsage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
  /** sessionId-scoped so tab switches hide/surface the drawer; cleared on resolve. */
  pendingApproval: PendingApproval | null;
  /** sessionId → the user's first prompt, a title FALLBACK shown until the run's
   *  auto-title lands in the DB. Bridges the window where a just-completed
   *  session is persisted with no title yet, so it never flashes "Untitled".
   *  In-memory only (a refresh re-derives in-flight titles from /api/runs/active). */
  provisionalTitles: Record<string, string>;

  setActiveSession: (id: string | null) => void;
  /** Update id without clearing messages — used after first send creates a session. */
  updateActiveSessionId: (id: string | null) => void;
  appendMessage: (msg: ChatMessage) => void;
  appendDelta: (delta: string) => void;
  /** Renders as a separate "Thinking" disclosure to avoid doubled answer text. */
  appendReasoning: (text: string) => void;
  appendToolCallPart: (tc: ToolCall) => void;
  upsertToolCall: (tc: ToolCall) => void;
  /** Fill tool result bodies by tool_call_id (DB role:tool rows → matching cards). */
  patchToolResultsById: (results: Record<string, string>) => void;
  /** Replace the rendered transcript with a DB-rebuilt one (single source of truth).
   *  Preserves the in-flight turn's live bubbles when a run is still active. */
  reconcileSession: (rebuilt: ChatMessage[]) => void;
  appendApprovalNoticeSegment: (choice: string, command: string) => void;
  /** Drop text segments on stream.reset; tool segments survive. */
  clearStreamingContent: () => void;
  /** Replace leaked pre-tool text with run.completed.output. */
  setFinalContent: (text: string) => void;
  setActiveRunId: (id: string | null) => void;
  setActiveTurn: (id: string | null) => void;
  setRunningForSession: (sessionId: string, runId: string) => void;
  clearRunningForSession: (sessionId: string) => void;
  /** Stable-id support: rebind a message's id (e.g. optimistic user → turn-<runId>-user). */
  renameMessageId: (oldId: string, newId: string) => void;
  clearMessages: () => void;
  setSelectedModel: (m: string | null) => void;
  setSelectedProvider: (p: string | null) => void;
  setReasoningEffort: (v: string | null) => void;
  setShowReasoning: (v: boolean) => void;
  setShowTokens: (v: boolean) => void;
  setLastUsage: (u: ChatState["lastUsage"]) => void;
  setHistoryPending: (v: boolean) => void;
  setPendingApproval: (p: PendingApproval | null) => void;
  setProvisionalTitle: (sessionId: string, title: string) => void;
}

/** Deterministic id for a turn's assistant bubble — all streaming events
 *  (delta / reasoning / tool) target this single message so a turn never
 *  splits into duplicate bubbles. Null turnId → legacy timestamp fallback. */
const assistantTurnId = (turnId: string | null): string | null =>
  turnId ? `turn-${turnId}-assistant` : null;

/** Locate the live assistant bubble: prefer the turn-keyed id, fall back to
 *  the last streaming assistant (covers null activeTurnId / legacy frames). */
function findStreamIdx(msgs: ChatMessage[], turnId: string | null): number {
  const wantId = assistantTurnId(turnId);
  if (wantId) {
    const i = msgs.findIndex((m) => m.id === wantId);
    if (i !== -1) return i;
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "assistant" && msgs[i].streaming) return i;
  }
  return -1;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
  activeSessionId: null,
  isHistoryPending: false,
  messages: [],
  activeRunId: null,
  activeTurnId: null,
  runningBySession: {},
  selectedModel: null,
  selectedProvider: null,
  reasoningEffort: null,
  showReasoning: true,
  showTokens: true,
  lastUsage: null,
  pendingApproval: null,
  provisionalTitles: {},

  setActiveSession: (id) =>
    set((s) => {
      // If clicking the same session that's already active, do nothing — prevents
      // erasing messages and the subsequent "content disappears" bug.
      if (id !== null && id === s.activeSessionId) return {};
      return {
        activeSessionId: id,
        messages: [],
        lastUsage: null,
        // isHistoryPending = true only when switching TO a real session;
        // new session (null) has nothing to load.
        isHistoryPending: id !== null,
      };
    }),
  updateActiveSessionId: (id) => set({ activeSessionId: id }),

  appendMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),

  appendDelta: (delta) =>
    set((s) => {
      const msgs = [...s.messages];
      const streamIdx = findStreamIdx(msgs, s.activeTurnId);

      if (streamIdx === -1) {
        // No bubble yet for this turn — create it with the turn-keyed id.
        msgs.push({
          id: assistantTurnId(s.activeTurnId) ?? `stream-${Date.now()}`,
          role: "assistant",
          content: "",
          segments: [{ type: "text", content: delta }],
          createdAt: Date.now(),
          streaming: true,
        });
        return { messages: msgs };
      }

      const target = msgs[streamIdx];
      const segs = target.segments ?? [];
      let newSegs: MessageSegment[];

      const lastSeg = segs[segs.length - 1];
      if (lastSeg && lastSeg.type === "text") {
        newSegs = [
          ...segs.slice(0, -1),
          { type: "text" as const, content: lastSeg.content + delta },
        ];
      } else {
        // Last segment is tool / empty — start a new TextSegment.
        newSegs = [...segs, { type: "text" as const, content: delta }];
      }

      msgs[streamIdx] = { ...target, segments: newSegs };
      return { messages: msgs };
    }),

  appendReasoning: (text) =>
    set((s) => {
      const msgs = [...s.messages];
      // Reasoning can arrive before any message.delta — create the bubble if needed.
      const streamIdx = findStreamIdx(msgs, s.activeTurnId);
      if (streamIdx === -1) {
        msgs.push({
          id: assistantTurnId(s.activeTurnId) ?? `stream-${Date.now()}`,
          role: "assistant",
          content: "",
          segments: [],
          reasoning: text,
          createdAt: Date.now(),
          streaming: true,
        });
        return { messages: msgs };
      }
      const target = msgs[streamIdx];
      msgs[streamIdx] = { ...target, reasoning: (target.reasoning ?? "") + text };
      return { messages: msgs };
    }),

  appendToolCallPart: (tc) =>
    set((s) => {
      const msgs = [...s.messages];
      const streamIdx = findStreamIdx(msgs, s.activeTurnId);

      const toolSeg: MessageSegment = { type: "tool", tc };

      if (streamIdx === -1) {
        msgs.push({
          id: assistantTurnId(s.activeTurnId) ?? `run-msg-${tc.id}`,
          role: "assistant",
          content: "",
          segments: [toolSeg],
          createdAt: Date.now(),
          streaming: true,
        });
      } else {
        const target = msgs[streamIdx];
        msgs[streamIdx] = {
          ...target,
          segments: [...(target.segments ?? []), toolSeg],
        };
      }

      return { messages: msgs };
    }),

  upsertToolCall: (tc) =>
    set((s) => {
      // Patch-merge — {...seg, tc} would blank preview/args/result when
      // tool.completed arrives with only id+status.
      const merge = (existing: ToolCall): ToolCall => ({ ...existing, ...tc });
      const msgs = s.messages.map((msg) => {
        if (msg.segments) {
          const hasTc = msg.segments.some(
            (seg) => seg.type === "tool" && seg.tc.id === tc.id
          );
          if (!hasTc) return msg;
          return {
            ...msg,
            segments: msg.segments.map((seg) =>
              seg.type === "tool" && seg.tc.id === tc.id
                ? { ...seg, tc: merge(seg.tc) }
                : seg
            ),
          };
        }
        // Legacy path for history messages without segments[].
        if (!msg.toolCalls) return msg;
        const pos = msg.toolCalls.findIndex((t) => t.id === tc.id);
        if (pos === -1) return msg;
        return {
          ...msg,
          toolCalls: msg.toolCalls.map((t) => (t.id === tc.id ? merge(t) : t)),
        };
      });
      return { messages: msgs };
    }),

  patchToolResultsById: (results) =>
    set((s) => {
      if (Object.keys(results).length === 0) return {};
      const patchSeg = (seg: MessageSegment): MessageSegment =>
        seg.type === "tool" && results[seg.tc.id] !== undefined
          ? { ...seg, tc: { ...seg.tc, result: results[seg.tc.id] } }
          : seg;
      const msgs = s.messages.map((msg) => {
        if (msg.segments) return { ...msg, segments: msg.segments.map(patchSeg) };
        if (!msg.toolCalls) return msg;
        return {
          ...msg,
          toolCalls: msg.toolCalls.map((tc) =>
            results[tc.id] !== undefined ? { ...tc, result: results[tc.id] } : tc
          ),
        };
      });
      return { messages: msgs };
    }),

  reconcileSession: (rebuilt) =>
    set((s) => {
      const runId = s.activeRunId;
      if (!runId) return { messages: rebuilt, isHistoryPending: false };
      // A run is still in flight for this session — the DB hasn't persisted the
      // current turn's assistant response yet (agent writes the transcript at the
      // end). Keep the live turn bubbles so streaming isn't wiped; DB owns the rest.
      const liveUser = s.messages.find((m) => m.id === `turn-${runId}-user`);
      const liveAsst = s.messages.find((m) => m.id === `turn-${runId}-assistant`);
      // The in-flight turn isn't in the DB yet (upstream persists on completion),
      // and the rebuild ids it as hist-<dbId>, never turn-<runId>-user — so the
      // rebuild can't represent it. Keep the live user bubble unless the rebuild's
      // LAST user message already IS this turn's prompt (i.e. it just got
      // persisted): that dedups without dropping the prompt in an EXISTING session
      // (whose rebuild legitimately has prior turns' user messages).
      const lastRebuiltUser = [...rebuilt].reverse().find((m) => m.role === "user");
      const dbHasThisUser =
        !!liveUser && lastRebuiltUser?.content?.trim() === liveUser.content?.trim();
      const tail: ChatMessage[] = [];
      if (liveUser && !dbHasThisUser) tail.push(liveUser);
      if (liveAsst) tail.push(liveAsst);
      return { messages: [...rebuilt, ...tail], isHistoryPending: false };
    }),

  clearStreamingContent: () =>
    set((s) => {
      const msgs = [...s.messages];
      const streamIdx = findStreamIdx(msgs, s.activeTurnId);
      if (streamIdx === -1) return {};
      const target = msgs[streamIdx];
      // Drop text; tool cards already rendered.
      const cleaned = (target.segments ?? []).filter((seg) => seg.type !== "text");
      msgs[streamIdx] = { ...target, segments: cleaned };
      return { messages: msgs };
    }),

  setFinalContent: (text) =>
    set((s) => {
      if (!text) return {};
      const msgs = [...s.messages];
      const streamIdx = findStreamIdx(msgs, s.activeTurnId);
      if (streamIdx === -1) return {};
      const target = msgs[streamIdx];
      // Keep tool/approval_notice; replace text with verified final response.
      const nonText = (target.segments ?? []).filter((seg) => seg.type !== "text");
      const newSeg: MessageSegment = { type: "text", content: text };
      msgs[streamIdx] = { ...target, segments: [...nonText, newSeg] };
      return { messages: msgs };
    }),

  appendApprovalNoticeSegment: (choice, command) =>
    set((s) => {
      const msgs = [...s.messages];
      let targetIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") { targetIdx = i; break; }
      }
      if (targetIdx === -1) return s;
      const target = msgs[targetIdx];
      const noticeSeg: MessageSegment = { type: "approval_notice", choice, command };
      msgs[targetIdx] = { ...target, segments: [...(target.segments ?? []), noticeSeg] };
      return { messages: msgs };
    }),

  setActiveRunId: (id) => set({ activeRunId: id }),
  setActiveTurn: (id) => set({ activeTurnId: id }),
  setRunningForSession: (sessionId, runId) =>
    set((s) => ({ runningBySession: { ...s.runningBySession, [sessionId]: runId } })),
  clearRunningForSession: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.runningBySession)) return {};
      const next = { ...s.runningBySession };
      delete next[sessionId];
      return { runningBySession: next };
    }),
  renameMessageId: (oldId, newId) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === oldId ? { ...m, id: newId } : m)),
    })),
  clearMessages: () => set({ messages: [], lastUsage: null }),
  setSelectedModel: (m) => set({ selectedModel: m }),
  setSelectedProvider: (p) => set({ selectedProvider: p }),
  setReasoningEffort: (v) => set({ reasoningEffort: v }),
  setShowReasoning: (v) => set({ showReasoning: v }),
  setShowTokens: (v) => set({ showTokens: v }),
  setLastUsage: (u) => set({ lastUsage: u }),
  setHistoryPending: (v) => set({ isHistoryPending: v }),
  setPendingApproval: (p) => set({ pendingApproval: p }),
  setProvisionalTitle: (sessionId, title) =>
    set((s) => {
      const next: Record<string, string> = { ...s.provisionalTitles, [sessionId]: title };
      // Bound the map (persisted): keep the most-recently-inserted ~60.
      const keys = Object.keys(next);
      if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete next[k];
      return { provisionalTitles: next };
    }),
    }),
    {
      name: "hms-chat-prefs",
      version: 2,
      // Older builds shipped "auto"/"max" — upstream falls back with a warning.
      // Map to canonical schema so the selector reflects gateway behavior.
      migrate: (persisted, version) => {
        const s = persisted as { reasoningEffort?: string | null } | undefined;
        if (!s) return s;
        if (version < 2) {
          if (s.reasoningEffort === "auto") s.reasoningEffort = null;
          if (s.reasoningEffort === "max") s.reasoningEffort = "xhigh";
        }
        return s;
      },
      partialize: (state) => ({
        selectedModel: state.selectedModel,
        selectedProvider: state.selectedProvider,
        reasoningEffort: state.reasoningEffort,
        showReasoning: state.showReasoning,
        showTokens: state.showTokens,
        activeSessionId: state.activeSessionId,
        // Persisted so refresh can re-subscribe to run:<id> instead of stuck streaming.
        activeRunId: state.activeRunId,
        // Persisted so a refresh / switch can re-attach a still-running run per session.
        runningBySession: state.runningBySession,
        // Persisted so a refresh during the title-not-ready window still has the
        // first-prompt fallback (otherwise the row briefly reads "Untitled").
        provisionalTitles: state.provisionalTitles,
      }),
    }
  )
);
