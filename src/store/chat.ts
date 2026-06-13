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
  /** Transient: a DB message_id the chat view should scroll to (from search). */
  pendingScrollMessageId: number | null;
  /** Agents room: runId → the profile-agent that turn was routed to (attribution). */
  /** sessionId → cumulative token usage from that session's last completed
   *  run — feeds the Composer context ring. Persisted (bounded) so the ring
   *  survives refresh and session switches. */
  usageBySession: Record<string, {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    context_length?: number;
    auto_compress_at?: number;
    auto_compress_percent?: number;
    context_used_tokens?: number;
  }>;
  /** Transient: runId → epoch-ms the run started (server clock on re-attach),
   *  so the turn timer survives a refresh instead of restarting at 0. */
  runStartedAt: Record<string, number>;
  /** sessionId → approval decisions taken in that session (`ord` = the visible
   *  user-turn ordinal the decision belongs to). Persisted (bounded) and
   *  re-injected on history rebuild so notices survive refresh. */
  approvalNotices: Record<string, Array<{ ord: number; choice: string; command: string }>>;
  /** sessionId-scoped so tab switches hide/surface the drawer; cleared on resolve. */
  pendingApproval: PendingApproval | null;
  /** sessionId → the user's first prompt, a title FALLBACK shown until the run's
   *  auto-title lands in the DB. Bridges the window where a just-completed
   *  session is persisted with no title yet, so it never flashes "Untitled".
   *  In-memory only (a refresh re-derives in-flight titles from /api/runs/active). */
  provisionalTitles: Record<string, string>;
  /** Transient: in-session regenerate / edit intent. The superseded turn is
   *  already marked as a hidden branch locally; ChatPanel fires the run with
   *  `truncate_before_user_ordinal` so the backend truncates state.db to match,
   *  then re-runs. Consumed once. */
  pendingRegenerate: { text: string; truncateBeforeUserOrdinal: number } | null;
  /** Transient: the branch group the NEXT streaming assistant bubble joins —
   *  set by supersedeTurn so a regenerated answer becomes a sibling of the
   *  answer it replaces (BranchPicker 1/2). Cleared by a normal send. */
  pendingBranchGroup: string | null;
  /** Transient: text to load into the Composer (edit / branch prefill).
   *  Reactive — works even when /chat is already mounted. */
  composerDraft: string | null;

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
  /** Settle the trailing streaming bubble: if the last message is still
   *  streaming, mark it done. The SINGLE reconciliation point every run
   *  terminal / abort path funnels through (terminal frame, stop,
   *  resume-on-mount, reconnect guard) so the "clear the trailing streaming
   *  bubble" reduction lives in exactly one place. No-op when the tail isn't a
   *  live stream. */
  settleStreamingMessage: () => void;
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
  setPendingScrollMessageId: (id: number | null) => void;
  setUsageForSession: (sessionId: string, u: ChatState["usageBySession"][string]) => void;
  setRunStartedAt: (runId: string, ms: number) => void;
  setHistoryPending: (v: boolean) => void;
  setPendingApproval: (p: PendingApproval | null) => void;
  setProvisionalTitle: (sessionId: string, title: string) => void;
  setPendingRegenerate: (v: { text: string; truncateBeforeUserOrdinal: number } | null) => void;
  setPendingBranchGroup: (g: string | null) => void;
  /** In-session regenerate: keep the user message at `userIndex`, mark its
   *  turn's assistant answers as hidden branch alternates (shared
   *  branchGroupId), drop every later turn, and arm pendingBranchGroup so the
   *  re-run's answer joins the same group as a visible sibling. */
  supersedeTurn: (userIndex: number) => void;
  /** Branch switch (assistant-ui setMessages): show exactly the branch-group
   *  members on the new active path, hide their siblings. Non-branch messages
   *  are untouched. */
  applyBranchVisibility: (visibleIds: readonly string[]) => void;
  /** In-session edit: drop the message at `index` and everything after it —
   *  the edited prompt replaces the turn linearly (no branch, like upstream
   *  desktop's edit), and the backend truncate removes it from state.db. */
  truncateMessagesBefore: (index: number) => void;
  setComposerDraft: (t: string | null) => void;
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

/** Bound a persisted map to its most-recently-inserted `max` keys. */
function trimMap<T>(map: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const next = { ...map };
  for (const k of keys.slice(0, keys.length - max)) delete next[k];
  return next;
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
  pendingScrollMessageId: null,
  usageBySession: {},
  runStartedAt: {},
  approvalNotices: {},
  pendingApproval: null,
  provisionalTitles: {},
  pendingRegenerate: null,
  pendingBranchGroup: null,
  composerDraft: null,

  setActiveSession: (id) =>
    set((s) => {
      // If clicking the same session that's already active, do nothing — prevents
      // erasing messages and the subsequent "content disappears" bug.
      if (id !== null && id === s.activeSessionId) return {};
      // Re-point the active run/turn at the NEW session's own in-flight run (if
      // any), else clear it. Otherwise a still-running run from the PREVIOUS
      // session stays "active" and a re-attach streams its content into this
      // session (cross-session bleed).
      const runId = id ? s.runningBySession[id] ?? null : null;
      return {
        activeSessionId: id,
        messages: [],
        activeRunId: runId,
        activeTurnId: runId,
        // isHistoryPending = true only when switching TO a real session;
        // new session (null) has nothing to load.
        isHistoryPending: id !== null,
        // Drop any stale in-session regenerate / branch intent on a switch.
        pendingRegenerate: null,
        pendingBranchGroup: null,
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
          ...(s.pendingBranchGroup ? { branchGroupId: s.pendingBranchGroup } : {}),
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
          segments: [{ type: "reasoning", content: text }],
          ...(s.pendingBranchGroup ? { branchGroupId: s.pendingBranchGroup } : {}),
          createdAt: Date.now(),
          streaming: true,
        });
        return { messages: msgs };
      }
      // Interleave in stream order (desktop-style): extend a trailing
      // reasoning segment, else start a new one where the stream is now.
      const target = msgs[streamIdx];
      const segs = target.segments ?? [];
      const lastSeg = segs[segs.length - 1];
      const newSegs: MessageSegment[] =
        lastSeg && lastSeg.type === "reasoning"
          ? [...segs.slice(0, -1), { type: "reasoning", content: lastSeg.content + text }]
          : [...segs, { type: "reasoning", content: text }];
      msgs[streamIdx] = { ...target, segments: newSegs };
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
          ...(s.pendingBranchGroup ? { branchGroupId: s.pendingBranchGroup } : {}),
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

  settleStreamingMessage: () =>
    set((s) => {
      // Key off the LAST message specifically (the trailing bubble), not the
      // turn-keyed lookup — a run terminal/abort settles whatever is currently
      // streaming at the tail. Atomic read-modify-write inside set().
      const last = s.messages[s.messages.length - 1];
      if (!last?.streaming) return {};
      return {
        messages: s.messages.map((m) =>
          m.id === last.id ? { ...m, streaming: false } : m
        ),
      };
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
      // Persist the decision (keyed by the turn's visible user ordinal) so a
      // history rebuild can re-inject the notice — it is frontend-synthetic
      // and the DB knows nothing about it.
      const sid = s.activeSessionId;
      if (!sid) return { messages: msgs };
      const ord = Math.max(
        0,
        msgs.filter((m) => m.role === "user" && !m.hidden).length - 1,
      );
      const forSession = [...(s.approvalNotices[sid] ?? []), { ord, choice, command }];
      return {
        messages: msgs,
        approvalNotices: trimMap({ ...s.approvalNotices, [sid]: forSession }, 40),
      };
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
  clearMessages: () => set({ messages: [] }),
  setSelectedModel: (m) => set({ selectedModel: m }),
  setSelectedProvider: (p) => set({ selectedProvider: p }),
  setReasoningEffort: (v) => set({ reasoningEffort: v }),
  setPendingScrollMessageId: (id) => set({ pendingScrollMessageId: id }),
  setUsageForSession: (sessionId, u) =>
    set((s) => ({ usageBySession: trimMap({ ...s.usageBySession, [sessionId]: u }, 60) })),
  setRunStartedAt: (runId, ms) =>
    set((s) => ({ runStartedAt: trimMap({ ...s.runStartedAt, [runId]: ms }, 60) })),
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
  setPendingRegenerate: (v) => set({ pendingRegenerate: v }),
  setPendingBranchGroup: (g) => set({ pendingBranchGroup: g }),
  supersedeTurn: (userIndex) =>
    set((s) => {
      const user = s.messages[userIndex];
      if (!user || user.role !== "user") return {};
      // The turn = everything up to (not including) the next user message.
      let end = s.messages.length;
      for (let i = userIndex + 1; i < s.messages.length; i++) {
        if (s.messages[i].role === "user") { end = i; break; }
      }
      const turn = s.messages.slice(userIndex + 1, end);
      // Re-regenerating an already-branched answer reuses its group so all
      // alternates stay siblings (1/2 → 1/3); first regenerate keys off the
      // user message that produced the turn.
      const group =
        turn.find((m) => m.role === "assistant" && m.branchGroupId)?.branchGroupId
        ?? `branch-${user.id}`;
      return {
        // Later turns are dropped — the backend truncate removes them from
        // state.db, so keeping them locally would show a transcript the agent
        // no longer has.
        messages: [
          ...s.messages.slice(0, userIndex + 1),
          ...turn.map((m) =>
            m.role === "assistant" ? { ...m, branchGroupId: group, hidden: true } : m
          ),
        ],
        pendingBranchGroup: group,
      };
    }),
  applyBranchVisibility: (visibleIds) =>
    set((s) => {
      const vis = new Set(visibleIds);
      let changed = false;
      const msgs = s.messages.map((m) => {
        if (m.role !== "assistant" || !m.branchGroupId) return m;
        const hidden = !vis.has(m.id);
        if ((m.hidden ?? false) === hidden) return m;
        changed = true;
        return { ...m, hidden };
      });
      return changed ? { messages: msgs } : {};
    }),
  truncateMessagesBefore: (index) =>
    set((s) => (index < 0 || index >= s.messages.length
      ? {}
      : { messages: s.messages.slice(0, index) })),
  setComposerDraft: (t) => set({ composerDraft: t }),
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
        activeSessionId: state.activeSessionId,
        // Persisted so refresh can re-subscribe to run:<id> instead of stuck streaming.
        activeRunId: state.activeRunId,
        // Persisted so a refresh / switch can re-attach a still-running run per session.
        runningBySession: state.runningBySession,
        // Persisted so a refresh during the title-not-ready window still has the
        // first-prompt fallback (otherwise the row briefly reads "Untitled").
        provisionalTitles: state.provisionalTitles,
        // The context ring + approval notices survive refresh.
        usageBySession: state.usageBySession,
        approvalNotices: state.approvalNotices,
      }),
    }
  )
);
