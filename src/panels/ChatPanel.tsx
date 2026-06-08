import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useCapabilityStore } from "@/store/capabilities";
import { useChatStore } from "@/store/chat";
import { useRunsStream } from "@/hooks/useRunsStream";
import { useChatRuntime } from "@/components/chat/assistant-ui/useChatRuntime";
import { useApprovalBridge } from "@/hooks/useApprovalBridge";
import ChatStream from "@/components/chat/ChatStream";
import Composer, { type ComposerHandle } from "@/components/chat/Composer";
import ApprovalDrawer from "@/components/chat/ApprovalDrawer";
import ChatTitleBar from "@/components/chat/ChatTitleBar";
import WorkspaceContextPanel from "@/components/chat/WorkspaceContextPanel";
import { useIsMobile } from "@/hooks/useBreakpoint";
import { useDangerousCommandApproval } from "@/hooks/useDangerousCommandApproval";
import { AlertTriangle } from "lucide-react";
import { loadSessionMessages } from "@/lib/load-session";
import type { SessionSummary } from "@/lib/hermes-types";
import Card from "@/components/ui/Card";
import HermesMark from "@/components/ui/HermesMark";

const WORKSPACE_OPEN_KEY = "hms:chat:workspace:open";

function ChatUnavailable({ reason }: { reason: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 'var(--hms-space-6)',
      }}
    >
      <Card
        style={{
          width: "min(100%, 460px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 'var(--hms-space-4)',
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-xs)', letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <HermesMark size={22} />
          Hermes Station
        </div>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "var(--hms-warning-weak)",
            color: "var(--hms-warning-text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AlertTriangle size={24} />
        </div>
        <div style={{ fontWeight: 600, color: "var(--hms-text)", fontSize: 'var(--hms-text-lg)' }}>Chat unavailable</div>
        <div style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)', lineHeight: 1.6 }}>
          {reason}
        </div>
      </Card>
    </div>
  );
}

export default function ChatPanel() {
  const { caps } = useCapabilityStore();
  const {
    messages, activeSessionId, isHistoryPending,
    appendMessage, setHistoryPending, reconcileSession,
  } = useChatStore();
  const appendApprovalNoticeSegment = useChatStore((s) => s.appendApprovalNoticeSegment);
  const { sendMessage, stopRun } = useRunsStream();
  // assistant-ui runtime bridging the chat store ↔ <Thread>. sendMessage /
  // stopRun stay the single drivers; the composer is still Station's own.
  const runtime = useChatRuntime({ onSend: (text) => void sendMessage(text), onCancel: stopRun });
  const { pending: pendingApproval, clear: clearPendingApproval } = useDangerousCommandApproval();
  // WS approval.requested → pendingApproval; resolveApproval wakes the same run via WS.
  const { resolveApproval } = useApprovalBridge();
  const activeRunId = useChatStore((s) => s.activeRunId);
  const pendingAutoSend = useChatStore((s) => s.pendingAutoSend);
  const pendingRegenerate = useChatStore((s) => s.pendingRegenerate);
  const queryClient = useQueryClient();
  const loadedSessionRef = useRef<string | null>(null);
  const loadingSessionRef = useRef<string | null>(null);
  const prevSessionRef = useRef<string | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const [panelDragOver, setPanelDragOver] = useState(false);
  const isMobile = useIsMobile();
  // Workspace context panel open state is remembered across sessions; first
  // visit defaults closed so the chat column stays clean.
  const [workspacesOpen, setWorkspacesOpen] = useState(() => {
    try { return localStorage.getItem(WORKSPACE_OPEN_KEY) === "1"; } catch { return false; }
  });
  const toggleWorkspaces = useCallback(() => {
    setWorkspacesOpen((o) => {
      const next = !o;
      try { localStorage.setItem(WORKSPACE_OPEN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const isTransitioningOut = false;

  const onPanelDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.some((t) => t === "Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setPanelDragOver(true);
    }
  }, []);
  const onPanelDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setPanelDragOver(false);
    }
  }, []);
  const onPanelDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setPanelDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) composerRef.current?.addFiles(files);
  }, []);

  // Load history on session switch. loadedSessionRef (not messages.length) is the
  // race-safe guard — message.delta on refresh can land before this effect runs.
  useEffect(() => {
    const prevSessionId = prevSessionRef.current;
    prevSessionRef.current = activeSessionId;

    if (!activeSessionId) {
      setHistoryPending(false);
      loadingSessionRef.current = null;
      return;
    }
    if (loadingSessionRef.current === activeSessionId) return;

    const currentMessages = useChatStore.getState().messages;

    const isSessionSwitch = prevSessionId !== null && prevSessionId !== activeSessionId;
    void isSessionSwitch;

    if (loadedSessionRef.current === activeSessionId) {
      if (currentMessages.length === 0) {
        // "Clear context" wiped messages — reset so navigate-away/back re-fetches.
        loadedSessionRef.current = null;
      } else {
        setHistoryPending(false);
        return;
      }
    }

    loadingSessionRef.current = activeSessionId;
    setHistoryPending(true);
    const fetchingSessionId = activeSessionId;
    // Read this session's owning profile from the shared sessions cache so the
    // transcript loads from THAT profile's state.db — a non-default-profile chat
    // lives in its own home, and a default-home read returns nothing.
    const cachedSessions =
      queryClient.getQueryData<{ sessions: SessionSummary[] }>(["sessions-table-all"]);
    const sessionProfile = cachedSessions?.sessions.find(
      (s) => s.session_id === fetchingSessionId,
    )?.profile;
    loadSessionMessages(fetchingSessionId, 200, sessionProfile)
      .then((chatMessages) => {
        // Drop stale load if user switched sessions mid-flight.
        if (loadingSessionRef.current !== fetchingSessionId) return;
        loadedSessionRef.current = fetchingSessionId;
        // Single source of truth: replace the transcript with the DB rebuild.
        // reconcileSession preserves the in-flight turn's live bubbles when a run
        // is still active, so a mid-run refresh/switch-back doesn't wipe streaming.
        reconcileSession(chatMessages);
        // Crash recovery: a run that died mid-turn (the gateway crashed before it
        // could persist) leaves its partial answer in a sidecar — surface it as a
        // trailing assistant bubble so the work isn't silently lost. The server
        // returns null if the run is actually still live (resuming over the WS).
        fetch(`/api/sessions/${encodeURIComponent(fetchingSessionId)}/interrupted`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { run_id?: string; user_input?: string; partial?: { text?: string } | null } | null) => {
            if (!data || loadedSessionRef.current !== fetchingSessionId) return;
            const text = data.partial?.text;
            const userInput = data.user_input;
            if (!text && !userInput) return;
            const stamp = data.run_id ?? Date.now();
            if (userInput) {
              appendMessage({
                id: `interrupted-user-${stamp}`,
                role: "user",
                content: userInput,
                createdAt: Date.now(),
              });
            }
            appendMessage({
              id: `interrupted-${stamp}`,
              role: "assistant",
              content: text
                ? `${text}\n\n_⚠️ Response interrupted — the gateway restarted mid-reply._`
                : "_⚠️ Response interrupted — the gateway restarted before replying._",
              createdAt: Date.now(),
            });
          })
          .catch(() => { /* best-effort */ });
      })
      .catch(() => {
        if (loadedSessionRef.current === fetchingSessionId) {
          loadedSessionRef.current = null;
        }
        if (loadingSessionRef.current === fetchingSessionId) {
          appendMessage({
            id: `history-error-${Date.now()}`,
            role: "assistant",
            content: "Failed to load conversation history. Refresh to retry.",
            createdAt: Date.now(),
          });
        }
      })
      .finally(() => {
        if (loadingSessionRef.current === activeSessionId) {
          loadingSessionRef.current = null;
        }
        setHistoryPending(false);
      });
  }, [activeSessionId, appendMessage, reconcileSession, setHistoryPending, queryClient]);

  // One-click "regenerate": a branch action set pendingAutoSend + a null active
  // session (so conversation_history seeds it); fire the send once it's in place.
  useEffect(() => {
    if (pendingAutoSend != null && activeSessionId === null) {
      const text = pendingAutoSend;
      useChatStore.getState().setPendingAutoSend(null);
      void sendMessage(text);
    }
  }, [pendingAutoSend, activeSessionId, sendMessage]);

  // In-session regenerate / edit: the transcript is already truncated locally;
  // fire the re-run with the truncate ordinal so the backend truncates state.db
  // to match. Stays in the same session (unlike the new-session branch above).
  useEffect(() => {
    if (pendingRegenerate != null && activeSessionId != null) {
      const { text, truncateBeforeUserOrdinal } = pendingRegenerate;
      useChatStore.getState().setPendingRegenerate(null);
      void sendMessage(text, undefined, { truncateBeforeUserOrdinal });
    }
  }, [pendingRegenerate, activeSessionId, sendMessage]);

  if (!caps) {
    return <ChatUnavailable reason="Checking capabilities…" />;
  }

  if (!caps.gatewayReachable) {
    return (
      <ChatUnavailable reason="Gateway is not reachable. Start hermes gateway to enable chat." />
    );
  }

  // Inline workspace context panel sits to the right of the chat column on
  // desktop (kept mounted so it can animate open/closed); on mobile (no
  // horizontal room) it falls back to a slide-over rendered only when open.
  const showOverlay = workspacesOpen && isMobile;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      {/* Full-width topbar across the chat + workspace area. The app's left nav
          sidebar lives outside ChatPanel, so this spans the content area only —
          the workspace panel sits BELOW it, connected (not overshooting it). */}
      <ChatTitleBar
        onToggleWorkspaces={toggleWorkspaces}
        workspacesOpen={workspacesOpen}
      />

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Chat main column */}
        <div
          style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, height: "100%", overflow: "hidden", position: "relative" }}
          onDragOver={onPanelDragOver}
          onDragLeave={onPanelDragLeave}
          onDrop={onPanelDrop}
        >
          {panelDragOver && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 100,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "color-mix(in srgb, var(--hms-accent) 8%, transparent)",
              border: "2px dashed var(--hms-accent)",
              pointerEvents: "none",
              fontSize: 'var(--hms-text-body)', fontWeight: 600, color: "var(--hms-accent)",
            }}>
              Drop files to attach
            </div>
          )}

          <AssistantRuntimeProvider runtime={runtime}>
            <ChatStream
              messages={messages}
              isLoadingHistory={isHistoryPending}
              isTransitioningOut={isTransitioningOut}
            />
          </AssistantRuntimeProvider>

          {pendingApproval && (
            <ApprovalDrawer
              payload={pendingApproval}
              // Dismiss [X] is silent — user must pick or deny to unblock event.wait().
              onDismiss={clearPendingApproval}
              onProceed={(choice) => {
                if (!activeSessionId) return;
                appendApprovalNoticeSegment(choice, pendingApproval.command);
                resolveApproval(activeSessionId, activeRunId, choice);
              }}
              onDeny={() => {
                if (!activeSessionId) return;
                appendApprovalNoticeSegment("deny", pendingApproval.command);
                resolveApproval(activeSessionId, activeRunId, "deny");
              }}
            />
          )}

          <Composer ref={composerRef} onSend={sendMessage} onStop={stopRun} sessionId={activeSessionId} />
        </div>

        {!isMobile && <WorkspaceContextPanel variant="inline" open={workspacesOpen} onClose={toggleWorkspaces} />}
      </div>
      {showOverlay && <WorkspaceContextPanel variant="overlay" onClose={toggleWorkspaces} />}
    </div>
  );
}
