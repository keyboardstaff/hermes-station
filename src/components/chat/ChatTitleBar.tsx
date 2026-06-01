import { useState, useRef, useEffect } from "react";
import { PanelRight, MoreHorizontal, Pencil, Download, Eraser } from "lucide-react";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/store/chat";
import { formatSessionTitle } from "@/lib/session-title";
import { useActiveSessionTitle } from "@/hooks/useActiveSessionTitle";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionSummary } from "@/lib/hermes-types";
import PageTopBar from "@/components/layout/PageTopBar";

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

/**
 * ChatTitleBar — top bar for ChatPanel.
 *
 * Left: session title (truncated)
 * Right: [FolderOpen workspaces toggle] [MoreHorizontal export/actions dropdown]
 *
 * The workspaces button calls `onToggleWorkspaces` which is owned by ChatPanel.
 * The export dropdown contains: Rename / Export JSON / Export Markdown / Clear.
 */
export default function ChatTitleBar({
  onToggleWorkspaces,
  workspacesOpen = false,
}: {
  onToggleWorkspaces: () => void;
  workspacesOpen?: boolean;
}) {
  const { t } = useI18n();
  const { activeSessionId, clearMessages } = useChatStore();
  const activeSessionTitle = useActiveSessionTitle();

  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const handleRename = () => {
    if (!activeSessionId) return;
    setMenuOpen(false);
    const current = formatSessionTitle(activeSessionTitle);
    const newTitle = window.prompt(t.nav.renameSession, current);
    if (!newTitle || newTitle.trim() === current) return;
    fetch(`/api/sessions/${encodeURIComponent(activeSessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
      body: JSON.stringify({ title: newTitle.trim() }),
    }).then((res) => {
      if (res.ok) {
        // Optimistically patch the shared cache (the single source of truth) so
        // the title bar updates instantly, then reconcile with the server.
        queryClient.setQueryData<{ sessions: SessionSummary[] }>(
          ["sessions-table-all"],
          (old) =>
            old
              ? {
                  ...old,
                  sessions: old.sessions.map((s) =>
                    s.session_id === activeSessionId
                      ? { ...s, title: newTitle.trim() }
                      : s,
                  ),
                }
              : old,
        );
        queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });
      }
    });
  };

  const handleClear = () => {
    setMenuOpen(false);
    clearMessages();
  };

  const title = activeSessionId
    ? formatSessionTitle(activeSessionTitle)
    : "New conversation";

  return (
    <PageTopBar
      title={title}
      actions={
        <>
          {/* Workspace context panel toggle */}
          <button
            type="button"
            onClick={onToggleWorkspaces}
            aria-label={t.nav.workspacesDrawer}
            aria-pressed={workspacesOpen}
            style={iconBtnStyle(workspacesOpen)}
          >
            <PanelRight size={16} />
          </button>

          {/* Export / actions menu */}
          {activeSessionId && (
            <div style={{ position: "relative" }} ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label={t.nav.exportSession}
                aria-expanded={menuOpen}
                style={iconBtnStyle(menuOpen)}
              >
                <MoreHorizontal size={16} />
              </button>

              {menuOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 4px)",
                    zIndex: 9999,
                    background: "var(--hms-surface)",
                    border: "1px solid var(--hms-border)",
                    borderRadius: 8,
                    padding: "4px 0",
                    minWidth: 180,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                  }}
                >
                  {([
                    { icon: <Pencil size={13} />, label: t.nav.renameSession, action: handleRename },
                    {
                      icon: <Download size={13} />, label: t.nav.exportJson, action: () => {
                        setMenuOpen(false);
                        exportSession(activeSessionId, "json");
                      }
                    },
                    {
                      icon: <Download size={13} />, label: t.nav.exportMarkdown, action: () => {
                        setMenuOpen(false);
                        exportSession(activeSessionId, "markdown");
                      }
                    },
                    { icon: <Eraser size={13} />, label: t.nav.clearSession, action: handleClear },
                  ] as { icon: React.ReactNode; label: string; action: () => void; danger?: boolean }[]).map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.action}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--hms-space-2)",
                        width: "100%",
                        padding: "8px 14px",
                        border: "none",
                        background: "none",
                        color: item.danger ? "var(--hms-error, #e53e3e)" : "var(--hms-text)",
                        fontSize: "var(--hms-text-sm)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--hms-surface-hover)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      }
    />
  );
}

function iconBtnStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    border: "none",
    borderRadius: 6,
    background: active ? "var(--hms-surface-hover)" : "transparent",
    color: active ? "var(--hms-text)" : "var(--hms-text-muted)",
    cursor: "pointer",
    flexShrink: 0,
  };
}
