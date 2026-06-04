import { PanelRight } from "lucide-react";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/store/chat";
import { formatSessionTitle } from "@/lib/session-title";
import { useActiveSessionTitle } from "@/hooks/useActiveSessionTitle";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionSummary } from "@/lib/hermes-types";
import PageTopBar from "@/components/layout/PageTopBar";
import IconButton from "@/components/ui/IconButton";
import { exportSessionsToPdf } from "@/lib/export-pdf";
import { usePinnedSessions } from "@/hooks/usePinnedSessions";
import SessionActionsMenu from "@/components/chat/SessionActionsMenu";

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
 * Right: [workspaces toggle] [··· session-actions dropdown]
 *
 * The ··· menu is the shared `SessionActionsMenu` (same item spec as the
 * SessionRecents right-click menu, via `buildSessionActions`): Rename / Pin /
 * Copy ID / Export JSON·MD·PDF / Clear local view / Archive / Delete.
 */
export default function ChatTitleBar({
  onToggleWorkspaces,
  workspacesOpen = false,
}: {
  onToggleWorkspaces: () => void;
  workspacesOpen?: boolean;
}) {
  const { t } = useI18n();
  const { activeSessionId, clearMessages, setActiveSession } = useChatStore();
  const activeSessionTitle = useActiveSessionTitle();
  const queryClient = useQueryClient();
  const { pinnedIds, toggle } = usePinnedSessions();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });

  const handleRenameSubmit = (next: string) => {
    if (!activeSessionId) return;
    fetch(`/api/sessions/${encodeURIComponent(activeSessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
      body: JSON.stringify({ title: next }),
    }).then((res) => {
      if (!res.ok) return;
      // Optimistically patch the shared cache so the title bar updates instantly.
      queryClient.setQueryData<{ sessions: SessionSummary[] }>(
        ["sessions-table-all"],
        (old) =>
          old
            ? {
                ...old,
                sessions: old.sessions.map((s) =>
                  s.session_id === activeSessionId ? { ...s, title: next } : s,
                ),
              }
            : old,
      );
      invalidate();
    });
  };

  const handleArchive = () => {
    if (!activeSessionId) return;
    fetch(`/api/dashboard/sessions/${encodeURIComponent(activeSessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
      body: JSON.stringify({ archived: true }),
    }).then(() => {
      invalidate();
      setActiveSession(null);
    });
  };

  const handleDelete = () => {
    if (!activeSessionId) return;
    fetch(`/api/dashboard/sessions/${encodeURIComponent(activeSessionId)}`, {
      method: "DELETE",
      headers: { "X-HMS-CSRF": "1" },
    }).then((res) => {
      if (!res.ok) return;
      invalidate();
      setActiveSession(null);
    });
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
          <IconButton
            active={workspacesOpen}
            onClick={onToggleWorkspaces}
            aria-label={t.nav.workspacesDrawer}
            aria-pressed={workspacesOpen}
          >
            <PanelRight size={16} />
          </IconButton>

          {/* Shared session-actions ··· menu */}
          {activeSessionId && (
            <SessionActionsMenu
              sessionId={activeSessionId}
              title={title}
              pinned={pinnedIds.has(activeSessionId)}
              onRenameSubmit={handleRenameSubmit}
              onTogglePin={() => toggle(activeSessionId)}
              onExportJson={() => exportSession(activeSessionId, "json")}
              onExportMarkdown={() => exportSession(activeSessionId, "markdown")}
              onExportPdf={() => exportSessionsToPdf([activeSessionId])}
              onClearLocal={clearMessages}
              onArchive={handleArchive}
              onDelete={handleDelete}
            />
          )}
        </>
      }
    />
  );
}
