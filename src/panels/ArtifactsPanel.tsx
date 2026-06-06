import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Image as ImageIcon, FileText, Link2, ExternalLink, MessageSquare,
  ChevronLeft, ChevronRight, ChevronDown, Layers,
} from "lucide-react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { useChatStore } from "@/store/chat";
import { loadSessionMessages } from "@/lib/load-session";
import { formatSessionTitle } from "@/lib/session-title";
import { extractArtifacts, type ArtifactKind, type SessionArtifact } from "@/lib/artifacts";
import type { SessionSummary } from "@/lib/hermes-types";
import PageTopBar from "@/components/layout/PageTopBar";

/**
 * ArtifactsPanel — a session's images / files / links, collected purely from
 * its messages (`extractArtifacts`, a read-only projection — no new storage).
 *
 * Pick a session (defaults to the active /chat session, else the most recent),
 * filter by kind, page through a uniform table with inline image previews, and
 * jump any row back to its message in /chat (`setActiveSession` +
 * `pendingScrollMessageId`, the same path as the command-palette search hit).
 */

const PAGE_SIZE = 24;
const KINDS: Array<ArtifactKind | "all"> = ["all", "image", "file", "link"];

/** Only http(s) / data / same-origin URLs open in a new tab; bare tool-written
 *  paths (e.g. `src/app.ts`) have no external target — show the path only. */
function isOpenable(url: string): boolean {
  return /^(https?:|data:|\/\/|\/)/i.test(url);
}

export default function ArtifactsPanel() {
  const { t } = useI18n();
  const a = t.artifacts;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setPendingScrollMessageId = useChatStore((s) => s.setPendingScrollMessageId);

  const [sessionId, setSessionId] = useState<string | null>(
    () => params.get("session") ?? activeSessionId,
  );
  const [kind, setKind] = useState<ArtifactKind | "all">("all");
  const [page, setPage] = useState(0);
  const [pickOpen, setPickOpen] = useState(false);
  const pickRef = useRef<HTMLDivElement>(null);

  // Session list for the picker (shares the SessionsPanel cache).
  const { data: sessData } = useQuery<{ sessions: SessionSummary[] }>({
    queryKey: ["sessions-table-all"],
    queryFn: () => api.get<{ sessions: SessionSummary[] }>("/api/sessions?limit=1000"),
    staleTime: 10_000,
  });
  const sessions = useMemo(
    () => [...(sessData?.sessions ?? [])].sort((x, y) => (y.updated_at ?? y.started_at ?? 0) - (x.updated_at ?? x.started_at ?? 0)),
    [sessData],
  );

  // Default to the most recent session when none is chosen yet.
  useEffect(() => {
    if (sessionId == null && sessions.length > 0) setSessionId(sessions[0].session_id);
  }, [sessionId, sessions]);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["session-artifacts-msgs", sessionId],
    enabled: sessionId != null,
    queryFn: () => loadSessionMessages(sessionId!, 1000),
    staleTime: 10_000,
  });

  const all = useMemo(() => extractArtifacts(messages ?? []), [messages]);
  const counts = useMemo(() => ({
    all: all.length,
    image: all.filter((x) => x.kind === "image").length,
    file: all.filter((x) => x.kind === "file").length,
    link: all.filter((x) => x.kind === "link").length,
  }), [all]);

  const filtered = kind === "all" ? all : all.filter((x) => x.kind === kind);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // Reset to the first page when the filter or session changes.
  useEffect(() => { setPage(0); }, [kind, sessionId]);

  // Close the session picker on outside click.
  useEffect(() => {
    if (!pickOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickRef.current && !pickRef.current.contains(e.target as Node)) setPickOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickOpen]);

  const openInChat = (art: SessionArtifact) => {
    if (sessionId == null) return;
    setActiveSession(sessionId);
    if (art.messageRowId != null) setPendingScrollMessageId(art.messageRowId);
    navigate("/chat");
  };

  const currentTitle = sessions.find((s) => s.session_id === sessionId)?.title;
  const sessionLabel = sessionId
    ? formatSessionTitle(currentTitle)
    : a.pickSession;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <PageTopBar
        title={t.nav.artifacts}
        subtitle={a.subtitle}
        actions={
          <div ref={pickRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setPickOpen((o) => !o)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-2)',
                maxWidth: 280, padding: "5px 10px", borderRadius: 6,
                border: "1px solid var(--hms-border)", background: "var(--hms-surface)",
                color: "var(--hms-text)", fontSize: 'var(--hms-text-caption)', cursor: "pointer",
              }}
            >
              <MessageSquare size={13} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sessionLabel}</span>
              <ChevronDown size={13} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />
            </button>
            {pickOpen && (
              <div
                style={{
                  position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 9999,
                  width: 300, maxHeight: 360, overflowY: "auto", padding: "4px 0", borderRadius: 8,
                  background: "var(--hms-surface)", border: "1px solid var(--hms-border)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                }}
              >
                {sessions.length === 0 && (
                  <div style={{ padding: "8px 14px", color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>{a.noSessions}</div>
                )}
                {sessions.map((s) => (
                  <button
                    key={s.session_id}
                    type="button"
                    onClick={() => { setSessionId(s.session_id); setPickOpen(false); }}
                    style={{
                      display: "block", width: "100%", padding: "7px 14px", border: "none",
                      background: s.session_id === sessionId ? "var(--hms-selected-bg)" : "none",
                      color: "var(--hms-text)", fontSize: 'var(--hms-text-sm)', cursor: "pointer", textAlign: "left",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => { if (s.session_id !== sessionId) (e.currentTarget as HTMLElement).style.background = "var(--hms-hover-bg)"; }}
                    onMouseLeave={(e) => { if (s.session_id !== sessionId) (e.currentTarget as HTMLElement).style.background = "none"; }}
                  >
                    {formatSessionTitle(s.title)}
                  </button>
                ))}
              </div>
            )}
          </div>
        }
        context={
          <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', padding: "6px 16px" }}>
            {KINDS.map((k) => {
              const active = kind === k;
              const label = k === "all" ? a.filterAll : k === "image" ? a.filterImages : k === "file" ? a.filterFiles : a.filterLinks;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
                    padding: "3px 10px", borderRadius: 999,
                    border: `1px solid ${active ? "var(--hms-accent)" : "var(--hms-border)"}`,
                    background: active ? "var(--hms-accent-weak)" : "var(--hms-surface)",
                    color: active ? "var(--hms-accent)" : "var(--hms-text-muted)",
                    fontSize: 'var(--hms-text-caption)', cursor: "pointer",
                  }}
                >
                  {label} <span style={{ opacity: 0.7 }}>{counts[k]}</span>
                </button>
              );
            })}
          </div>
        }
      />

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {sessionId == null ? (
          <EmptyState icon={<MessageSquare size={36} />} title={a.noSession} hint={a.noSessionHint} />
        ) : isLoading ? (
          <div style={{ padding: 'var(--hms-space-6)', color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>{a.loading}</div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Layers size={36} />} title={a.empty} hint={a.emptyHint} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)', padding: 'var(--hms-space-4)' }}>
            {pageItems.map((art) => (
              <ArtifactRow key={art.key} art={art} t={a} onOpenInChat={() => openInChat(art)} />
            ))}

            {pageCount > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 'var(--hms-space-3)', padding: 'var(--hms-space-3)' }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  aria-label={a.prev}
                  style={pagerBtn(page === 0)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>{page + 1} / {pageCount}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={page >= pageCount - 1}
                  aria-label={a.next}
                  style={pagerBtn(page >= pageCount - 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 30, height: 30, borderRadius: 6,
    border: "1px solid var(--hms-border)", background: "var(--hms-surface)",
    color: disabled ? "var(--hms-text-muted)" : "var(--hms-text)",
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
  };
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 'var(--hms-space-3)', color: "var(--hms-text-muted)", padding: 'var(--hms-space-8)',
        textAlign: "center", height: "100%",
      }}
    >
      <div style={{ color: "var(--hms-text-muted)" }}>{icon}</div>
      <div style={{ fontWeight: 600, color: "var(--hms-text)", fontSize: 'var(--hms-text-body)' }}>{title}</div>
      <div style={{ maxWidth: 420, fontSize: 'var(--hms-text-sm)' }}>{hint}</div>
    </div>
  );
}

function ArtifactRow({
  art, t, onOpenInChat,
}: {
  art: SessionArtifact;
  t: { openInChat: string; open: string };
  onOpenInChat: () => void;
}) {
  const [imgOk, setImgOk] = useState(true);
  const openable = isOpenable(art.url);

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 'var(--hms-space-3)',
        padding: "8px 10px", borderRadius: 8,
        border: "1px solid var(--hms-border)", background: "var(--hms-surface)",
      }}
    >
      {/* Preview / type */}
      <div
        style={{
          width: 44, height: 44, flexShrink: 0, borderRadius: 6, overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--hms-hover-bg)", color: "var(--hms-text-muted)",
        }}
      >
        {art.kind === "image" && imgOk ? (
          <img
            src={art.url}
            alt={art.label}
            onError={() => setImgOk(false)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : art.kind === "image" ? (
          <ImageIcon size={18} />
        ) : art.kind === "file" ? (
          <FileText size={18} />
        ) : (
          <Link2 size={18} />
        )}
      </div>

      {/* Label + url */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 'var(--hms-text-sm)', fontWeight: 600, color: "var(--hms-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {art.label}
        </div>
        <div style={{ fontSize: 'var(--hms-text-xs)', fontFamily: "monospace", color: "var(--hms-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {art.url}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-1)', flexShrink: 0 }}>
        {openable && (
          <a
            href={art.url}
            target="_blank"
            rel="noreferrer"
            title={t.open}
            aria-label={t.open}
            style={iconLink}
          >
            <ExternalLink size={15} />
          </a>
        )}
        <button
          type="button"
          onClick={onOpenInChat}
          title={t.openInChat}
          aria-label={t.openInChat}
          style={{ ...iconLink, border: "none", background: "none", cursor: "pointer" }}
        >
          <MessageSquare size={15} />
        </button>
      </div>
    </div>
  );
}

const iconLink: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 30, height: 30, borderRadius: 6,
  color: "var(--hms-text-muted)", textDecoration: "none",
};
