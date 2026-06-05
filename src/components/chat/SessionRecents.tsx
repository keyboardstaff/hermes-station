import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, MessageSquare, MoreHorizontal, Trash2, X, Check, Loader2, ChevronDown } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { formatSessionTitle } from "@/lib/session-title";
import { exportSessionsToPdf } from "@/lib/export-pdf";
import { buildSessionActions, clearSessionMessages } from "@/lib/session-actions";
import { useAgentRoomStore } from "@/store/agentRoom";
import type { SessionSummary } from "@/lib/hermes-types";
import { useState, useRef, useEffect, useCallback } from "react";
import { useI18n } from "@/i18n";
import Tooltip from "@/components/ui/Tooltip";

function relativeTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return Math.round(diff / 60) + "m";
  if (diff < 86400) return Math.round(diff / 3600) + "h";
  if (diff < 86400 * 7) return Math.round(diff / 86400) + "d";
  return new Date(ts * 1000).toLocaleDateString();
}

// In-flight run surfaced as an "in progress" Recents row (GET /api/runs/active).
interface ActiveRun {
  run_id: string;
  session_id: string;
  started_at: number;
  title: string;
}

// Session context menu
interface MenuState {
  sessionId: string;
  x: number;
  y: number;
}

async function exportSession(sessionId: string, format: "json" | "markdown") {
  const res = await fetch(`/api/dashboard/sessions/${encodeURIComponent(sessionId)}/messages`);
  if (!res.ok) return;
  const data = await res.json();
  const messages: Array<{ role: string; content: string | null }> = data.messages ?? [];

  let content: string;
  let filename: string;
  if (format === "json") {
    content = JSON.stringify({ session_id: sessionId, messages }, null, 2);
    filename = `${sessionId}.json`;
  } else {
    // Render only human-readable turns. Skip role=tool (raw JSON) and
    // role=system (internal). For assistant messages that store content as
    // an empty string (segment-only bubbles) the body is omitted gracefully.
    const HEADING: Record<string, string> = { user: "## User", assistant: "## Assistant" };
    const parts = messages
      .filter((m) => HEADING[m.role] && (m.content ?? "").trim().length > 0)
      .map((m) => `${HEADING[m.role]}\n\n${(m.content ?? "").trim()}`);
    content = parts.join("\n\n---\n\n");
    filename = `${sessionId}.md`;
  }
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Per-session row with hover state, rename mode, and ••• menu trigger
interface SessionItemProps {
  session: SessionSummary;
  isActive: boolean;
  isRunning: boolean;
  isRenaming: boolean;
  renameValue: string;
  shiftHeld: boolean;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onClick: (e: React.MouseEvent) => void;
  onMenuOpen: (x: number, y: number) => void;
  onDelete: () => void;
}

function SessionItem({
  session: s,
  isActive,
  isRunning,
  isRenaming,
  renameValue,
  shiftHeld,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onClick,
  onMenuOpen,
  onDelete,
}: SessionItemProps) {
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) inputRef.current?.select();
  }, [isRenaming]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 'var(--hms-space-2)',
        padding: "7px 8px",
        borderRadius: 8,
        cursor: "pointer",
        background: (isActive || hovered) ? "var(--hms-border)" : "transparent",
        position: "relative",
        transition: "background 0.12s",
      }}
    >
      <MessageSquare size={13} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />
      {isRenaming ? (
        <div style={{ display: "flex", gap: 'var(--hms-space-1)', alignItems: "center", flex: 1 }} onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameSubmit();
              if (e.key === "Escape") onRenameCancel();
            }}
            style={{
              flex: 1,
              fontSize: 'var(--hms-text-sm)',
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid var(--hms-border)",
              background: "var(--hms-bg)",
              color: "var(--hms-text)",
              outline: "none",
            }}
          />
          <button onClick={onRenameSubmit} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--hms-text-muted)", padding: 2 }}>
            <Check size={13} />
          </button>
          <button onClick={onRenameCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--hms-text-muted)", padding: 2 }}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <>
          {/* Title (flex: 1, truncate) */}
          <span style={{
            flex: 1,
            fontSize: 'var(--hms-text-sm)',
            color: "var(--hms-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {formatSessionTitle(s.title)}
          </span>
          {/* Relative time */}
          <span style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", flexShrink: 0 }}>
            {relativeTime(s.updated_at ?? s.started_at)}
          </span>
          {/* While a run is streaming for the active session, replace the
              action button with a spinner so the user can see something is
              still in flight even if the chat scrolled off-screen. */}
          {isRunning ? (
            <span
              title="Run in progress"
              aria-label="loading"
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                color: "var(--hms-text)",
              }}
            >
              <Loader2 size={13} className="hms-spin" />
            </span>
          ) : (hovered || isActive) && !isRenaming && (
            shiftHeld ? (
              <Tooltip label="Delete session" placement="left">
                <button
                  aria-label="Delete session"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    border: "none",
                    background: "transparent",
                    color: "var(--hms-error, #e53e3e)",
                    cursor: "pointer",
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </Tooltip>
            ) : (
              <Tooltip label="More options" placement="left">
                <button
                  aria-label="More options"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    onMenuOpen(rect.right + 4, rect.top);
                  }}
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    border: "none",
                    background: "transparent",
                    color: "var(--hms-text-muted)",
                    cursor: "pointer",
                  }}
                >
                  <MoreHorizontal size={13} />
                </button>
              </Tooltip>
            )
          )}
        </>
      )}
    </div>
  );
}

export interface SessionRecentsProps {
  /** Header title text. Defaults to "Sessions". */
  headerTitle?: string;
  /** When false, suppresses the "+ New" button (Sidebar already has one). */
  showNewButton?: boolean;
  /** When set, renders a "View all →" link on the right of the header. */
  viewAllHref?: string;
  /** After picking a session, also navigate here (e.g. "/chat" from Sidebar Recents). */
  navigateOnPick?: string;
  /** Adds a chevron toggle to the header that hides/shows the list body. */
  collapsible?: boolean;
  /** When true, View-all + chevron only fade in on hover (Sidebar Recents). */
  hoverRevealsActions?: boolean;
  /** Drop the divider below the header (Sidebar Recents wants no inner border). */
  borderless?: boolean;
  /** Title for the pinned section header. */
  pinnedTitle?: string;
  /** Set of pinned session IDs; when provided renders a Pinned section. */
  pinnedIds?: Set<string>;
  /** Callback to toggle pin/unpin for a session. */
  onTogglePin?: (id: string) => void;
  /** Maximum number of unpinned sessions to show. */
  limit?: number;
}

export default function SessionRecents({
  headerTitle,
  showNewButton = true,
  viewAllHref,
  navigateOnPick,
  collapsible = false,
  hoverRevealsActions = false,
  borderless = false,
  pinnedTitle = "Pinned",
  pinnedIds,
  onTogglePin,
  limit,
}: SessionRecentsProps = {}) {
  const { t } = useI18n();
  const { activeSessionId, setActiveSession, clearMessages, setProvisionalTitle } = useChatStore();
  // Every session with a live run shows a spinner — not just the focused one,
  // so concurrent runs are all visible.
  const runningBySession = useChatStore((s) => s.runningBySession);
  // Title fallback while a run's auto-title is still being generated.
  const provisionalTitles = useChatStore((s) => s.provisionalTitles);
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  const [containerHovered, setContainerHovered] = useState(false);
  const navigate = useNavigate();
  // The "active" row only reads as active on the chat page (where that session
  // is actually open). Elsewhere (e.g. the isolated /agents room) a stale active
  // highlight is misleading.
  const activeOnChat = useLocation().pathname === "/chat";
  const roomSessionIds = new Set(useAgentRoomStore((s) => s.sessionIds));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Track whether Shift key is currently held for instant-delete mode
  const [shiftHeld, setShiftHeld] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const archiveSession = useCallback(async (sessionId: string) => {
    await fetch(`/api/dashboard/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
      body: JSON.stringify({ archived: true }),
    });
    queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });
  }, [queryClient]);

  const clearContext = useCallback((sessionId: string) => {
    // Clearing only affects the locally-rendered view of this session; the
    // upstream DB rows stay. Useful when the user wants a fresh visual scrollback
    // before continuing the same session.
    if (sessionId === activeSessionId) clearMessages();
  }, [activeSessionId, clearMessages]);

  // Close menu on outside click
  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menu]);

  // Global Shift key tracker for instant-delete mode
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") setShiftHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/dashboard/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { "X-HMS-CSRF": "1" },
    });
    if (!res.ok) {
      console.error(`Failed to delete session: ${res.status}`);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });
    if (activeSessionId === sessionId) setActiveSession(null);
  }, [activeSessionId, queryClient, setActiveSession]);

  // Opening a new session: clear active selection. ChatPanel header takes over
  // the "New conversation" affordance; no list-row placeholder is rendered.
  const handleNewSession = useCallback(() => {
    setActiveSession(null);
  }, [setActiveSession]);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    // Python backend is RESTful: PATCH /api/sessions/{id} with {title}.
    // (The old Node proxy bundled session_id into the body via POST.)
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
      body: JSON.stringify({ title: title.trim() || "Untitled" }),
    });
    if (!res.ok) {
      console.error(`Failed to rename session: ${res.status}`);
      setRenamingId(null);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });
    setRenamingId(null);
  }, [queryClient]);

  // Shared cache with /sessions (``SessionsFilters``, ``SessionsPanel``).
  // limit=1000 is the same upper bound the sessions table uses so the
  // two views agree on the count and a hit on either page warms both.
  const { data, isError } = useQuery<{ sessions: SessionSummary[] }>({
    queryKey: ["sessions-table-all"],
    queryFn: async () => {
      const res = await fetch("/api/sessions?limit=1000");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    // One retry so a transient blip (a rate-limit burst on refresh, a momentary
    // backend hiccup) self-heals instead of stranding "Dashboard unavailable".
    retry: 1,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    refetchInterval: 30_000,
  });

  // In-flight runs (in-memory registry) → display-only "in progress" rows for
  // sessions not yet in state.db (upstream persists on completion). Fetched on
  // mount so they survive a refresh, then polled for cross-tab runs. NOT merged
  // into the sessions cache, so useActiveSessionTitle keeps reading the canonical
  // DB rows — the LLM-generated title replaces the provisional one automatically
  // once the real row lands in the DB list.
  const { data: activeData } = useQuery<{ runs: ActiveRun[] }>({
    queryKey: ["runs-active"],
    queryFn: async () => {
      const res = await fetch("/api/runs/active");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    retry: false,
    staleTime: 2_000,
    refetchInterval: 5_000,
  });
  const activeRuns = activeData?.runs ?? [];

  // Title is derived directly from this `sessions-table-all` cache by
  // useActiveSessionTitle (single source of truth) — no store propagation needed.

  // "New conversation" lives in the ChatPanel header when activeSessionId is
  // null; we deliberately do not render a placeholder row there. The top-right
  // `+` button is the one and only entry point to start a new session.
  const dbSessions = data?.sessions ?? [];
  const dbSessionIds = new Set(dbSessions.map((s) => s.session_id));
  // Prepend in-flight sessions the DB doesn't have yet (newest → top); dropped
  // automatically once the real row appears (its id enters dbSessionIds).
  const inflightRows: SessionSummary[] = activeRuns
    .filter((r) => !dbSessionIds.has(r.session_id))
    .map((r) => ({
      session_id: r.session_id,
      title: r.title || undefined,
      started_at: r.started_at,
      updated_at: r.started_at,
    }));
  // Spinner source: a session is "running" if it's a synthetic in-flight row
  // OR this client still tracks its run. Keying off this (not the raw active
  // set) means a completed run — now in dbSessionIds, so out of inflight — stops
  // spinning at once instead of lingering until the next /api/runs/active poll.
  const inflightSessionIds = new Set(inflightRows.map((r) => r.session_id));
  // Fall back to the provisional (first-prompt) title while the DB row still has
  // none — so a just-completed session shows the prompt, never "Untitled".
  const sessions = [...inflightRows, ...dbSessions]
    // Hide the isolated /agents room's own run sessions from /chat Recents.
    .filter((s) => !roomSessionIds.has(s.session_id))
    .map((s) => (s.title?.trim() ? s : { ...s, title: provisionalTitles[s.session_id] }));

  // Split into pinned and recents when pinnedIds is provided.
  const pinnedSessions = pinnedIds && pinnedIds.size > 0
    ? sessions.filter((s) => pinnedIds.has(s.session_id))
    : [];
  const displaySessions = pinnedIds
    ? sessions.filter((s) => !pinnedIds.has(s.session_id)).slice(0, limit)
    : limit
      ? sessions.slice(0, limit)
      : sessions;

  // Header actions (View all / chevron) fade in on container hover
  // when hoverRevealsActions=true. Always visible otherwise.
  const actionsOpacity = hoverRevealsActions ? (containerHovered ? 1 : 0) : 1;

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}
      onMouseEnter={() => setContainerHovered(true)}
      onMouseLeave={() => setContainerHovered(false)}
    >
      {/* Pinned section — only when caller provides pinnedIds and list is non-empty */}
      {pinnedSessions.length > 0 && (
        <div style={{ flexShrink: 0 }}>
          <div style={{ padding: "12px 12px 4px", display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setPinnedCollapsed((c) => !c)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                flex: 1,
                background: "none",
                border: "none",
                padding: "2px 0",
                cursor: "pointer",
                color: "var(--hms-text)",
                fontSize: 'var(--hms-text-sm)',
                fontWeight: 600,
                textAlign: "left",
              }}
            >
              <span>{pinnedTitle}</span>
              <ChevronDown
                size={13}
                style={{
                  color: "var(--hms-text-muted)",
                  flexShrink: 0,
                  transition: "transform 0.22s ease, opacity var(--hms-transition)",
                  transform: pinnedCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                  opacity: hoverRevealsActions ? (containerHovered ? 1 : 0) : 1,
                }}
              />
            </button>
          </div>
          <div style={{
            overflow: "hidden",
            maxHeight: pinnedCollapsed ? 0 : "240px",
            transition: "max-height 0.22s ease, opacity 0.18s ease",
            opacity: pinnedCollapsed ? 0 : 1,
          }}>
            <div style={{ overflowY: "auto", maxHeight: "240px", padding: "0 6px 6px" }}>
              {pinnedSessions.map((s) => (
                <SessionItem
                  key={s.session_id}
                  session={s}
                  isActive={activeOnChat && activeSessionId === s.session_id}
                  isRunning={inflightSessionIds.has(s.session_id) || !!runningBySession[s.session_id]}
                  isRenaming={renamingId === s.session_id}
                  renameValue={renameValue}
                  shiftHeld={shiftHeld}
                  onRenameChange={setRenameValue}
                  onRenameSubmit={() => renameSession(s.session_id, renameValue)}
                  onRenameCancel={() => setRenamingId(null)}
                  onClick={() => {
                    setActiveSession(s.session_id);
                    if (navigateOnPick) navigate(navigateOnPick);
                  }}
                  onMenuOpen={(x, y) => setMenu({ sessionId: s.session_id, x, y })}
                  onDelete={() => deleteSession(s.session_id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          padding: "12px 12px 8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: borderless ? "none" : "1px solid var(--hms-border)",
          flexShrink: 0,
        }}
      >
        {collapsible ? (
          <button
            onClick={() => setCollapsed((c) => !c)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              flex: 1,
              background: "none",
              border: "none",
              padding: "2px 0",
              cursor: "pointer",
              color: "var(--hms-text)",
              fontSize: 'var(--hms-text-sm)',
              fontWeight: 600,
              textAlign: "left",
            }}
          >
            <span>{headerTitle ?? "Sessions"}</span>
            <ChevronDown
              size={13}
              style={{
                color: "var(--hms-text-muted)",
                flexShrink: 0,
                transition: "transform 0.22s ease, opacity var(--hms-transition)",
                transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                opacity: hoverRevealsActions ? actionsOpacity : 1,
              }}
            />
          </button>
        ) : (
          <span style={{ fontSize: 'var(--hms-text-sm)', fontWeight: 600 }}>{headerTitle ?? "Sessions"}</span>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 'var(--hms-space-2)',
            opacity: actionsOpacity,
            transition: "opacity var(--hms-transition)",
            pointerEvents: actionsOpacity === 0 ? "none" : undefined,
          }}
        >
          {viewAllHref && (
            <button
              onClick={() => navigate(viewAllHref)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontSize: 'var(--hms-text-xs)',
                color: "var(--hms-text-muted)",
              }}
            >
              View all →
            </button>
          )}

          {showNewButton && (
            <button
              onClick={handleNewSession}
              title="New session"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                borderRadius: 6,
                border: "1px solid var(--hms-border)",
                background: "transparent",
                color: "var(--hms-text-muted)",
                cursor: "pointer",
              }}
            >
              <Plus size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Session list — animated collapse/expand (Sidebar Recents). */}
      <div style={{
        flex: 1,
        overflow: "hidden",
        minHeight: 0,
        maxHeight: collapsed ? 0 : "100%",
        transition: "max-height 0.22s ease, opacity 0.18s ease",
        opacity: collapsed ? 0 : 1,
      }}>
        <div style={{ overflowY: "auto", padding: "6px 6px", height: "100%" }}>
        {isError && (
          <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", padding: "8px 6px" }}>
            Dashboard unavailable — session history not loaded.
          </div>
        )}

        {sessions.length === 0 && !isError && (
          <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", padding: "8px 6px" }}>
            No sessions yet.
          </div>
        )}

        {displaySessions.map((s) => (
          <SessionItem
            key={s.session_id}
            session={s}
            isActive={activeOnChat && activeSessionId === s.session_id}
            isRunning={inflightSessionIds.has(s.session_id) || !!runningBySession[s.session_id]}
            isRenaming={renamingId === s.session_id}
            renameValue={renameValue}
            shiftHeld={shiftHeld}
            onRenameChange={setRenameValue}
            onRenameSubmit={() => renameSession(s.session_id, renameValue)}
            onRenameCancel={() => setRenamingId(null)}
            onClick={() => {
              setActiveSession(s.session_id);
              if (navigateOnPick) navigate(navigateOnPick);
            }}
            onMenuOpen={(x, y) => setMenu({ sessionId: s.session_id, x, y })}
            onDelete={() => deleteSession(s.session_id)}
          />
        ))}
        </div>
      </div>

      {/* Context menu */}
      {menu && (
        <div
          ref={menuRef}
          style={{
            position: "fixed",
            left: menu.x,
            top: menu.y,
            zIndex: 9999,
            background: "var(--hms-surface)",
            border: "1px solid var(--hms-border)",
            borderRadius: 8,
            padding: "4px 0",
            minWidth: 160,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          {buildSessionActions(t, {
            pinned: pinnedIds?.has(menu.sessionId),
            onRename: () => {
              const s = sessions.find((x) => x.session_id === menu.sessionId);
              setRenameValue(s?.title ?? "");
              setRenamingId(menu.sessionId);
            },
            onTogglePin: onTogglePin ? () => onTogglePin(menu.sessionId) : undefined,
            onCopyId: () => void navigator.clipboard?.writeText(menu.sessionId),
            onExportJson: () => exportSession(menu.sessionId, "json"),
            onExportMarkdown: () => exportSession(menu.sessionId, "markdown"),
            onExportPdf: () => exportSessionsToPdf([menu.sessionId]),
            onClearSession: () => {
              void clearSessionMessages(menu.sessionId).then((ok) => {
                if (ok) {
                  clearContext(menu.sessionId);
                  setProvisionalTitle(menu.sessionId, "");
                  queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });
                }
              });
            },
            onArchive: () => archiveSession(menu.sessionId),
            onDelete: () => deleteSession(menu.sessionId),
          }).map((item) => (
            <button
              key={item.key}
              onClick={() => { item.onSelect(); setMenu(null); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 'var(--hms-space-2)',
                width: "100%",
                padding: "7px 14px",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: 'var(--hms-text-sm)',
                color: item.danger ? "var(--hms-error, #e53e3e)" : "var(--hms-text)",
                textAlign: "left",
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
