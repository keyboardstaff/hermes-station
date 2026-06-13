import { PanelRight, Workflow } from "lucide-react";
import { useI18n } from "@/i18n";
import { useOverlays } from "@/store/overlays";
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
import { clearSessionMessages } from "@/lib/session-actions";

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
 * The session title IS the actions trigger: clicking it opens the shared
 * `SessionActionsMenu` (same item spec as the SessionRecents right-click menu,
 * via `buildSessionActions`): Pin / Rename / Copy ID / Export JSON·MD·PDF /
 * Clear Session / Archive / Delete. No separate ··· button. Right side keeps
 * only the workspaces toggle.
 */
export default function ChatTitleBar({
  onToggleWorkspaces,
  workspacesOpen = false,
}: {
  onToggleWorkspaces: () => void;
  workspacesOpen?: boolean;
}) {
  const { t } = useI18n();
  const { activeSessionId, clearMessages, setActiveSession, setProvisionalTitle } = useChatStore();
  const activeSessionTitle = useActiveSessionTitle();
  const queryClient = useQueryClient();
  const { pinnedIds, toggle } = usePinnedSessions();
  const openAgents = useOverlays((s) => s.openAgents);

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

  const handleClearSession = () => {
    if (!activeSessionId) return;
    void clearSessionMessages(activeSessionId).then((ok) => {
      if (ok) {
        clearMessages();
        // Drop the stale provisional title so the bar shows a fresh session and
        // the next turn's auto-title regenerates (backend reset the DB title too).
        setProvisionalTitle(activeSessionId, "");
        invalidate();
      }
    });
  };

  const title = activeSessionId
    ? formatSessionTitle(activeSessionTitle)
    : t.nav.newSession;

  return (
    <PageTopBar
      title={
        activeSessionId ? (
          <SessionActionsMenu
            sessionId={activeSessionId}
            title={title}
            pinned={pinnedIds.has(activeSessionId)}
            onRenameSubmit={handleRenameSubmit}
            onTogglePin={() => toggle(activeSessionId)}
            onExportJson={() => exportSession(activeSessionId, "json")}
            onExportMarkdown={() => exportSession(activeSessionId, "markdown")}
            onExportPdf={() => exportSessionsToPdf([activeSessionId])}
            onClearSession={handleClearSession}
            onArchive={handleArchive}
            onDelete={handleDelete}
          />
        ) : (
          title
        )
      }
      actions={
        <>
          <IconButton
            onClick={openAgents}
            aria-label={t.nav.agents}
            title={t.nav.agents}
          >
            <Workflow size={16} />
          </IconButton>
          <IconButton
            active={workspacesOpen}
            onClick={onToggleWorkspaces}
            aria-label={t.nav.workspacesDrawer}
            aria-pressed={workspacesOpen}
          >
            <PanelRight size={16} />
          </IconButton>
        </>
      }
    />
  );
}
