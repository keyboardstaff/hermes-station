import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2, X, ChevronLeft, ChevronRight, MessageSquare, Archive, ArchiveRestore } from "lucide-react";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { formatSessionTitle } from "@/lib/session-title";
import { useSessionsFilters } from "@/store/filters";
import { useChatStore } from "@/store/chat";
import { useLivePreview } from "@/hooks/useLivePreview";
import { useI18n } from "@/i18n";
import SessionsFilters from "@/components/sessions/SessionsFilters";
import PageTopBar from "@/components/layout/PageTopBar";
import { ChatThread } from "@/components/chat/ChatThread";
import type { ChatMessage, SessionSummary } from "@/lib/hermes-types";
import { api } from "@/lib/api";

import type { MessageRow } from "@/lib/session-messages";
import { historyToChatMessages } from "@/lib/session-messages";
import { profileQuery } from "@/lib/load-session";
import { exportSessionsToPdf } from "@/lib/export-pdf";

function relativeTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

async function exportSessions(ids: string[], format: "json" | "markdown") {
  const results = await Promise.all(
    ids.map((id) =>
      api
        // Export needs the whole transcript; pass the max limit the
        // backend accepts so we don't silently truncate large sessions.
        .get<{ messages?: MessageRow[] }>(
          `/api/sessions/${encodeURIComponent(id)}/messages?limit=5000`,
        )
        .catch(() => ({ messages: [] }))
        .then((d) => ({ id, messages: d.messages ?? [] }))
    )
  );

  let content: string;
  let filename: string;
  if (format === "json") {
    content = JSON.stringify(results, null, 2);
    filename = `sessions-export.json`;
  } else {
    content = results
      .map(({ id, messages }) =>
        `# Session: ${id}\n\n` +
        (messages as MessageRow[]).map((m) => `**${m.role}**: ${m.content}`).join("\n\n---\n\n")
      )
      .join("\n\n====\n\n");
    filename = `sessions-export.md`;
  }

  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// PDF export: render the transcript (Markdown + math + Mermaid, tool cards
// stripped) into a print window → browser "Save as PDF". Fetch + render live
// in export-pdf.tsx so all call sites (here, ChatTitleBar, Recents) share it.
async function exportSessionsPdf(ids: string[]) {
  if (!(await exportSessionsToPdf(ids))) alert("Allow pop-ups to export as PDF.");
}

const PAGE_SIZE = 50;

export default function SessionsPanel() {
  const { t } = useI18n();
  const { debouncedSearch, sourceFilter, profileFilter, view, page, setPage } = useSessionsFilters();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const archivedView = view === "archived";

  // Fetch ALL sessions once, do client-side filter/search/pagination. The
  // archived view uses a SEPARATE cache key + `?archived=only` so the canonical
  // `sessions-table-all` (sidebar Recents, title bar) stays active-only.
  const { data: allData, isLoading } = useQuery<{ sessions: SessionSummary[] }>({
    queryKey: archivedView ? ["sessions-table-archived"] : ["sessions-table-all"],
    queryFn: () =>
      api.get<{ sessions: SessionSummary[] }>(
        `/api/sessions?limit=1000${archivedView ? "&archived=only" : ""}`,
      ),
    staleTime: 10_000,
  });

  const invalidateSessions = () => {
    queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });
    queryClient.invalidateQueries({ queryKey: ["sessions-table-archived"] });
  };

  // Bulk archive / unarchive — profile-scoped PATCH (rows carry their profile).
  const { mutate: setArchivedBulk, isPending: archiving } = useMutation({
    mutationFn: async ({ ids, archived }: { ids: string[]; archived: boolean }) => {
      const byId = new Map((allData?.sessions ?? []).map((s) => [s.session_id, s.profile]));
      await Promise.all(
        ids.map((id) => {
          // First (only) query param ⇒ `?profile=`. profileQuery() yields the
          // `&`-prefixed form for appending to an existing query string, which
          // would malform `/api/sessions/{id}` (no `?`) → wrong db.
          const prof = byId.get(id);
          const q = prof && prof !== "default" ? `?profile=${encodeURIComponent(prof)}` : "";
          return api.json<unknown>(`/api/sessions/${encodeURIComponent(id)}${q}`, "PATCH", { archived });
        }),
      );
    },
    onSuccess: () => { setSelected(new Set()); invalidateSessions(); },
  });

  // Fetch preview messages. The previous swallow-non-2xx-as-empty code
  // path masked failures behind a "Loading… then empty" drawer. The
  // ``api`` wrapper throws ``ApiError`` for us, react-query surfaces
  // it as ``previewError``, and the drawer renders a clear message.
  // The session's owning profile (rows are tagged by the cross-home list) so the
  // preview reads from THAT profile's state.db — a non-default-profile session's
  // transcript lives in its own home, not the default one.
  const previewProfile = preview
    ? allData?.sessions.find((s) => s.session_id === preview)?.profile
    : undefined;
  const {
    data: previewData,
    isLoading: previewLoading,
    error: previewError,
  } = useQuery<{ messages: MessageRow[] }>({
    queryKey: ["session-preview", preview, previewProfile ?? null],
    queryFn: () =>
      preview
        ? api.get<{ messages: MessageRow[] }>(
            `/api/sessions/${encodeURIComponent(preview)}/messages?limit=100${profileQuery(previewProfile)}`,
          )
        : Promise.resolve({ messages: [] }),
    enabled: !!preview,
    retry: 1,
  });

  const { mutate: deleteSelected, isPending: deleting } = useMutation({
    mutationFn: async (ids: string[]) => {
      // ``api.json`` attaches the CSRF header automatically, so this
      // matches the wrapper conventions instead of re-implementing
      // ``X-HMS-CSRF: 1`` inline at the call site.
      await Promise.all(
        ids.map((id) =>
          api.json<unknown>(
            `/api/dashboard/sessions/${encodeURIComponent(id)}`,
            "DELETE",
          ),
        ),
      );
    },
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["sessions-table-all"] });
    },
  });

  // Fall back to the provisional (first-prompt) title while the DB row has none,
  // so a just-completed session never reads "Untitled" here either.
  const provisionalTitles = useChatStore((s) => s.provisionalTitles);
  const allSessions = (allData?.sessions ?? []).map((s) =>
    s.title?.trim() ? s : { ...s, title: provisionalTitles[s.session_id] },
  );

  // Client-side filter (search + source + profile)
  const filteredSessions = allSessions.filter((s) => {
    if (sourceFilter !== "all" && s.source !== sourceFilter) return false;
    if (profileFilter !== "all" && (s.profile || "default") !== profileFilter) return false;
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      const title = formatSessionTitle(s.title).toLowerCase();
      const model = (s.model ?? "").toLowerCase();
      const src = (s.source ?? "").toLowerCase();
      return title.includes(q) || model.includes(q) || src.includes(q);
    }
    return true;
  });

  const total = filteredSessions.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Filter/search shrinkage can leave `page` past the end → empty table that
  // looks like "no sessions". Clamp back to the last valid page.
  useEffect(() => {
    if (page > totalPages - 1) setPage(totalPages - 1);
  }, [totalPages, page, setPage]);
  const sessions = filteredSessions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === sessions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sessions.map((s) => s.session_id)));
    }
  };

  const noneSelected = selected.size === 0;

  return (
    <div className="hms-sessions-panel">
      <PageTopBar
        title={t.nav.sessions}
        context={<SessionsFilters total={total} />}
      />

      {/* Body. Position relative so the preview drawer can be absolute
          and overlay 50% of the area without re-flowing the table. */}
      <div className="hms-sessions-body">
        <div className="hms-sessions-table-wrap">
          <div className="hms-sessions-table-shell">
            {isLoading && (
              <div className="hms-sessions-empty">{t.sessions.loading}</div>
            )}
            {!isLoading && sessions.length === 0 && (
              <div className="hms-sessions-empty">{t.sessions.empty}</div>
            )}
            {!isLoading && sessions.length > 0 && (
              <table className="hms-sessions-table">
                <thead>
                  <tr className="hms-sessions-table-head">
                    <th className="hms-sessions-cell hms-sessions-cell--check">
                      <input
                        type="checkbox"
                        checked={selected.size === sessions.length && sessions.length > 0}
                        onChange={toggleAll}
                        style={{ cursor: "pointer" }}
                      />
                    </th>
                    <th className="hms-sessions-cell">{t.sessions.colTitle}</th>
                    <th className="hms-sessions-cell">{t.sessions.colProfile}</th>
                    <th className="hms-sessions-cell">{t.sessions.colSource}</th>
                    <th className="hms-sessions-cell">{t.sessions.colModel}</th>
                    <th className="hms-sessions-cell hms-sessions-cell--time">{t.sessions.colTime}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr
                      key={s.session_id}
                      onClick={() => setPreview(preview === s.session_id ? null : s.session_id)}
                      className="hms-sidebar-row hms-sessions-row"
                      data-active={preview === s.session_id}
                    >
                      <td className="hms-sessions-row-cell" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(s.session_id)}
                          onChange={() => toggleSelect(s.session_id)}
                          style={{ cursor: "pointer" }}
                        />
                      </td>
                      <td className="hms-sessions-row-cell hms-sessions-row-title">
                        {formatSessionTitle(s.title)}
                      </td>
                      <td className="hms-sessions-row-cell hms-sessions-row-muted hms-sessions-row-profile">
                        {s.profile ?? "default"}
                      </td>
                      <td className="hms-sessions-row-cell hms-sessions-row-muted hms-sessions-row-source">
                        {s.source ?? "—"}
                      </td>
                      <td className="hms-sessions-row-cell hms-sessions-row-muted hms-sessions-row-model">
                        {s.model ?? "—"}
                      </td>
                      <td className="hms-sessions-row-cell hms-sessions-row-time hms-sessions-row-muted">
                        {relativeTime(s.updated_at ?? s.started_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Preview drawer — overlay (not flex sibling), 50% width,
            click-outside dismisses. Renders history through
            ``historyToChatMessages`` + the shared ``ChatThread`` (same
            lazy ``ChatBubble`` as /chat) so Markdown + ToolCallCard
            render identically. */}
        {preview && (
          <PreviewDrawer
            sessionId={preview}
            title={formatSessionTitle(sessions.find((s) => s.session_id === preview)?.title)}
            onClose={() => setPreview(null)}
            messages={previewData?.messages}
            loading={previewLoading}
            error={previewError}
          />
        )}

        {/* Floating contextual action bar — appears only when ≥1 row is
            selected, centred over the table (doesn't occupy permanent space). */}
        {!noneSelected && (
          <div
            className="hms-floatbar-in"
            style={{
              position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 5,
              display: "flex", alignItems: "center", gap: 'var(--hms-space-2)',
              padding: "8px 12px", borderRadius: 999,
              background: "var(--hms-surface)", border: "1px solid var(--hms-border)",
              boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
            }}
          >
            <span style={{ fontSize: 'var(--hms-text-caption)', fontWeight: 600, color: "var(--hms-text)", paddingLeft: 'var(--hms-space-1)' }}>
              {selected.size} {t.sessions.selected}
            </span>
            <span style={{ width: 1, height: 18, background: "var(--hms-border)" }} aria-hidden="true" />
            <Button size="sm" onClick={() => exportSessions(Array.from(selected), "json")}>
              <Download size={12} /> {t.sessions.exportJson}
            </Button>
            <Button size="sm" onClick={() => exportSessions(Array.from(selected), "markdown")}>
              <Download size={12} /> {t.sessions.exportMarkdown}
            </Button>
            <Button size="sm" onClick={() => exportSessionsPdf(Array.from(selected))}>
              <Download size={12} /> {t.sessions.exportPdf}
            </Button>
            {archivedView ? (
              <Button size="sm" disabled={archiving} onClick={() => setArchivedBulk({ ids: Array.from(selected), archived: false })}>
                <ArchiveRestore size={12} /> {t.sessions.unarchive}
              </Button>
            ) : (
              <Button size="sm" disabled={archiving} onClick={() => setArchivedBulk({ ids: Array.from(selected), archived: true })}>
                <Archive size={12} /> {t.sessions.archive}
              </Button>
            )}
            <Button size="sm" variant="danger" disabled={deleting} onClick={() => { if (confirm(t.sessions.deleteConfirm)) deleteSelected(Array.from(selected)); }}>
              <Trash2 size={12} /> {t.sessions.delete}
            </Button>
          </div>
        )}
      </div>

      {/* Footer — pagination only. Bulk actions live in the floating bar above. */}
      {totalPages > 1 && (
        <div className="hms-sessions-pagination" style={{ justifyContent: "center" }}>
          <Button size="sm" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
            <ChevronLeft size={13} />
          </Button>
          <span className="hms-sessions-pagination-status">
            {t.sessions.page} {page + 1} / {totalPages}
          </span>
          <Button size="sm" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
            <ChevronRight size={13} />
          </Button>
        </div>
      )}
    </div>
  );
}


function PreviewDrawer({
  sessionId, title, onClose, messages, loading, error,
}: {
  sessionId: string;
  title: string;
  onClose: () => void;
  messages: MessageRow[] | undefined;
  loading: boolean;
  error: Error | null;
}) {
  const navigate = useNavigate();
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  // Live-mirror the in-flight turn (when this session is running) so the preview
  // streams in real time like /chat — kept in local state, never the global chat
  // store, so it can't cross-contaminate whatever session /chat owns.
  const live = useLivePreview(sessionId);
  const chatMessages = useMemo<ChatMessage[]>(
    () => [...historyToChatMessages(messages ?? []), ...live],
    [messages, live]
  );

  // Jump this session into the live /chat view — same path as the Sidebar
  // Recents pick: set the active session, then navigate; ChatPanel's load
  // effect keys off ``activeSessionId`` and pulls the history.
  const openInChat = () => {
    setActiveSession(sessionId);
    navigate("/chat");
  };

  // Close on Esc — matches the X button affordance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Click-outside backdrop. Transparent so the table behind stays
          fully visible; the drawer itself sits on top. */}
      <div onClick={onClose} className="hms-sessions-preview-backdrop" />
      <div
        // ``key`` forces a fresh node when sessionId changes, so the
        // slide-in animation re-runs.
        key={sessionId}
        onClick={(e) => e.stopPropagation()}
        className="hms-sessions-preview"
      >
        <div className="hms-sessions-preview-toolbar">
          <span className="hms-sessions-preview-title">{title}</span>
          <div className="hms-sessions-preview-actions">
            <IconButton
              onClick={openInChat}
              title="Open in chat"
              aria-label="Open in chat"
            >
              <MessageSquare size={14} />
            </IconButton>
            <IconButton
              onClick={onClose}
              aria-label="Close preview"
            >
              <X size={14} />
            </IconButton>
          </div>
        </div>
        <ChatThread
          messages={chatMessages}
          loading={loading}
          error={error}
          labels={{
            loading: "Loading messages...",
            empty: "This session has no messages.",
            error: "Could not load messages",
          }}
          style={{ flex: 1, padding: "12px 14px", gap: 'var(--hms-space-3)' }}
        />
      </div>
    </>
  );
}
