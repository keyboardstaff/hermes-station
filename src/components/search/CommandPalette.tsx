import { useState, useCallback, useEffect, useRef, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, ChevronRight, Zap } from "lucide-react";
import { useI18n } from "@/i18n";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useChatStore } from "@/store/chat";
import { useThemeStore } from "@/store/app";
import { navCommands, filterCommands, type Command } from "@/lib/commands";

interface MessageHit {
  session_id: string;
  message_id: number;
  snippet?: string;
}

interface CommandPaletteProps {
  onClose: () => void;
}

type Row =
  | { key: string; kind: "command"; group: Command["group"]; label: string; onSelect: () => void }
  | { key: string; kind: "message"; group: "messages"; label: string; onSelect: () => void };

/**
 * ⌘K command palette: search messages (FTS), navigate to any page, and run app
 * actions (new chat, toggle theme/reasoning/tokens) from one surface. Nav
 * commands derive from the ROUTES registry (see `lib/commands.ts`); message
 * results come from `/api/search`. Supersedes the old GlobalSearch (nav +
 * search only, and it queried a dead dashboard path).
 */
export default function CommandPalette({ onClose }: CommandPaletteProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const showReasoning = useChatStore((s) => s.showReasoning);
  const setShowReasoning = useChatStore((s) => s.setShowReasoning);
  const showTokens = useChatStore((s) => s.showTokens);
  const setShowTokens = useChatStore((s) => s.setShowTokens);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<MessageHit[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const debouncedQuery = useDebouncedValue(query, 400);

  // Animate out, then unmount (mirrors ShortcutsPanel). Guarded so a second
  // trigger during the 200ms exit doesn't double-fire.
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(onClose, 200);
  }, [onClose]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  // App actions — closures over the live store/router (the ROUTES-derived nav
  // commands are the pure part, in lib/commands.ts).
  const actions: Command[] = [
    {
      id: "act:new-chat", label: t.palette.newChat, group: "action",
      keywords: "new chat session conversation",
      run: () => { setActiveSession(null); navigate("/chat"); },
    },
    {
      id: "act:theme", label: t.palette.toggleTheme, group: "action",
      keywords: "theme dark light appearance",
      run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    },
    {
      id: "act:reasoning", label: t.palette.toggleReasoning, group: "action",
      keywords: "reasoning thinking trace",
      run: () => setShowReasoning(!showReasoning),
    },
    {
      id: "act:tokens", label: t.palette.toggleTokens, group: "action",
      keywords: "tokens usage context ring",
      run: () => setShowTokens(!showTokens),
    },
  ];

  const filtered = filterCommands([...actions, ...navCommands(t, navigate)], query);

  // Message full-text search — only when there's a query. Uses the real FTS
  // endpoint (`/api/search`), not the dead dashboard path the old palette hit.
  useEffect(() => {
    if (!debouncedQuery) { setMessages([]); return; }
    let cancelled = false;
    fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}&limit=6`)
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .then((d: { results?: MessageHit[] }) => { if (!cancelled) setMessages(d.results ?? []); })
      .catch(() => { if (!cancelled) setMessages([]); });
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  const openMessage = useCallback((sessionId: string) => {
    // Open the conversation that contains the matched message (SessionsPanel
    // doesn't honor ?id=, and the chat view is the more useful landing).
    setActiveSession(sessionId);
    navigate("/chat");
    requestClose();
  }, [setActiveSession, navigate, requestClose]);

  const rows: Row[] = [
    ...filtered.map((c) => ({
      key: c.id, kind: "command" as const, group: c.group, label: c.label,
      onSelect: () => { c.run(); requestClose(); },
    })),
    ...messages.map((m) => ({
      key: `msg:${m.session_id}:${m.message_id}`, kind: "message" as const, group: "messages" as const,
      label: (m.snippet || "").replace(/\s+/g, " ").trim() || "(message)",
      onSelect: () => openMessage(m.session_id),
    })),
  ];

  const groupLabel: Record<string, string> = {
    action: t.palette.actions, page: t.palette.pages, messages: t.palette.messages,
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { rows[selectedIdx]?.onSelect(); }
    else if (e.key === "Escape") { requestClose(); }
  };

  return (
    <>
      <div
        onClick={requestClose}
        className={closing ? "animate-fadeOut" : "animate-fadeIn"}
        style={{ position: "fixed", inset: 0, background: "var(--hms-dialog-backdrop)", zIndex: 98 }}
      />
      <div
        className={closing ? "animate-paletteOut" : "animate-paletteIn"}
        style={{
          position: "fixed",
          top: "16%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 640,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--hms-surface)",
          border: "1px solid var(--hms-border)",
          borderRadius: 12,
          zIndex: 99,
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          overflow: "hidden",
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
          onKeyDown={handleKey}
          placeholder={t.palette.placeholder}
          style={{
            width: "100%",
            padding: "14px 18px",
            border: "none",
            borderBottom: "1px solid var(--hms-border)",
            background: "transparent",
            fontSize: 'var(--hms-text-base)',
            color: "var(--hms-text)",
            outline: "none",
          }}
        />

        {rows.length > 0 && (
          <div style={{ maxHeight: 440, overflowY: "auto" }}>
            {rows.map((r, i) => {
              const prevGroup = i > 0 ? rows[i - 1].group : null;
              const showHeader = r.group !== prevGroup;
              return (
                <Fragment key={r.key}>
                  {showHeader && (
                    <div style={{
                      padding: "8px 18px 4px",
                      fontSize: 'var(--hms-text-xs)',
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--hms-text-muted)",
                    }}>
                      {groupLabel[r.group]}
                    </div>
                  )}
                  <button
                    onClick={r.onSelect}
                    onMouseEnter={() => setSelectedIdx(i)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 'var(--hms-space-2)',
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 18px",
                      border: "none",
                      background: i === selectedIdx ? "var(--hms-border)" : "transparent",
                      cursor: "pointer",
                      color: "var(--hms-text)",
                    }}
                  >
                    {r.kind === "message"
                      ? <MessageSquare size={13} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />
                      : r.group === "action"
                        ? <Zap size={13} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />
                        : <ChevronRight size={13} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />}
                    <span style={{
                      fontSize: 'var(--hms-text-sm)', flex: 1, minWidth: 0,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {r.label}
                    </span>
                  </button>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
