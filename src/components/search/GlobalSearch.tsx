import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface SessionResult {
  session_id: string;
  title: string;
  snippet?: string;
  started_at?: number;
}

interface NavResult {
  label: string;
  to: string;
}

interface GlobalSearchProps {
  onClose: () => void;
}

const NAV_ENTRIES: { label: string; to: string }[] = [
  { label: "Chat", to: "/chat" },
  { label: "Sessions", to: "/sessions" },
  { label: "Analytics", to: "/analytics" },
  { label: "Logs", to: "/logs" },
  { label: "Settings", to: "/settings" },
  { label: "Skills", to: "/skills" },
  { label: "Models", to: "/models" },
  { label: "Channels", to: "/channels" },
  { label: "Cron", to: "/cron" },
  { label: "Kanban", to: "/kanban" },
  { label: "Files", to: "/files" },
  { label: "Profile", to: "/profile" },
  { label: "Plugins", to: "/plugins" },
];

export default function GlobalSearch({ onClose }: GlobalSearchProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 500);

  const navResults: NavResult[] = query
    ? NAV_ENTRIES.filter((e) => e.label.toLowerCase().includes(query.toLowerCase()))
    : NAV_ENTRIES.slice(0, 5);

  // Fetch session search results
  useEffect(() => {
    if (!debouncedQuery) { setSessions([]); return; }
    fetch(`/api/dashboard/sessions/search?q=${encodeURIComponent(debouncedQuery)}&limit=5`)
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => setSessions([]));
  }, [debouncedQuery]);

  const allResults = [
    ...navResults.map((r) => ({ type: "nav" as const, ...r })),
    ...sessions.map((s) => ({ type: "session" as const, label: s.title || "Untitled", to: `/sessions?id=${s.session_id}`, snippet: s.snippet })),
  ];

  const go = useCallback(
    (to: string) => {
      navigate(to);
      onClose();
    },
    [navigate, onClose]
  );

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      setSelectedIdx((i) => Math.min(i + 1, allResults.length - 1));
    } else if (e.key === "ArrowUp") {
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && allResults[selectedIdx]) {
      go(allResults[selectedIdx].to);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "var(--hms-dialog-backdrop)", zIndex: 98 }}
      />
      <div
        style={{
          position: "fixed",
          top: "20%",
          left: "50%",
          transform: "translateX(-50%)",
          width: 520,
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
          placeholder={t.common.search + "..."}
          style={{
            width: "100%",
            padding: "12px 16px",
            border: "none",
            borderBottom: "1px solid var(--hms-border)",
            background: "transparent",
            fontSize: 'var(--hms-text-base)',
            color: "var(--hms-text)",
            outline: "none",
          }}
        />

        {allResults.length > 0 && (
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {allResults.map((r, i) => (
              <button
                key={r.to + i}
                onClick={() => go(r.to)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 16px",
                  border: "none",
                  background: i === selectedIdx ? "var(--hms-border)" : "transparent",
                  cursor: "pointer",
                  color: "var(--hms-text)",
                }}
              >
                <span style={{ fontSize: 'var(--hms-text-sm)', display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
                  {r.type === "session"
                    ? <MessageSquare size={13} style={{ flexShrink: 0 }} />
                    : <ChevronRight size={13} style={{ flexShrink: 0 }} />
                  }
                  {r.label}
                </span>
                {r.type === "session" && r.snippet && (
                  <span style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", marginTop: 2 }}>
                    {r.snippet}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
