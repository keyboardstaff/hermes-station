import { useState } from "react";
import Editor from "@monaco-editor/react";
import { History, X, ChevronLeft } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  useFileLog,
  useFileShow,
  type FileRoot,
  type LogEntry,
} from "@/hooks/useFiles";
import { guessLanguage } from "./language";

/**
 * Git commit history for a single file.
 *
 * `variant="sidebar"` — 280 px wide, bordered, used by the desktop
 * `/files` page where the editor and history sit side-by-side.
 *
 * `variant="panel"` — full-width, no chrome, used by the chat
 * `WorkspaceContextPanel` where history *replaces* the editor instead of
 * sharing the row (no horizontal space for a side-by-side layout).
 */
export default function FileVersionHistory({
  root,
  path,
  monacoTheme,
  onClose,
  variant = "sidebar",
}: {
  root: FileRoot;
  path: string;
  monacoTheme: string;
  onClose: () => void;
  variant?: "sidebar" | "panel";
}) {
  const { t } = useI18n();
  const f = t.files;
  const logQuery = useFileLog(root, path, true);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const showQuery = useFileShow(root, path, selectedRef ?? "", !!selectedRef);

  const entries: LogEntry[] = logQuery.data?.entries ?? [];

  const wrapperStyle: React.CSSProperties = variant === "sidebar"
    ? {
        width: 280,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid var(--hms-border)",
        background: "var(--hms-surface)",
        overflow: "hidden",
        height: "100%",
      }
    : {
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      };

  return (
    <div style={wrapperStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 10px",
          borderBottom: "1px solid var(--hms-border)",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <History size={12} style={{ color: "var(--hms-text-muted)" }} />
        <span style={{ fontSize: "var(--hms-text-xs)", fontWeight: 600, flex: 1 }}>
          {f.historyTitle}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={f.backToFile}
          title={f.backToFile}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            border: "none",
            borderRadius: 4,
            background: "transparent",
            color: "var(--hms-text-muted)",
            cursor: "pointer",
          }}
        >
          <X size={13} />
        </button>
      </div>

      {selectedRef ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div
            style={{
              padding: "4px 10px",
              borderBottom: "1px solid var(--hms-border)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedRef(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 4px",
                fontSize: "var(--hms-text-xs)",
                color: "var(--hms-accent)",
              }}
            >
              <ChevronLeft size={11} />
              {t.common.back}
            </button>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: "0.65rem",
                color: "var(--hms-text-muted)",
                marginLeft: "auto",
              }}
            >
              {selectedRef.slice(0, 7)}
            </span>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            {showQuery.isLoading ? (
              <div style={loadingStyle}>{f.loading}</div>
            ) : (
              <Editor
                height="100%"
                theme={monacoTheme}
                value={showQuery.data?.content ?? ""}
                language={guessLanguage(path)}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  wordWrap: "on",
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  lineNumbers: "off",
                  lineDecorationsWidth: 0,
                  glyphMargin: false,
                  folding: false,
                  scrollbar: { verticalScrollbarSize: 4, horizontalScrollbarSize: 4, useShadows: false },
                  overviewRulerLanes: 0,
                  overviewRulerBorder: false,
                  quickSuggestions: false,
                }}
              />
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto" }}>
          {logQuery.isLoading && <div style={loadingStyle}>{f.loading}</div>}
          {!logQuery.isLoading && entries.length === 0 && (
            <div style={loadingStyle}>{f.historyEmpty}</div>
          )}
          {entries.map((entry) => (
            <button
              key={entry.hash}
              type="button"
              onClick={() => setSelectedRef(entry.hash)}
              title={f.historyViewAt}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                border: "none",
                borderBottom: "1px solid var(--hms-border)",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-1)", marginBottom: 2 }}>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "0.6rem",
                    color: "var(--hms-accent)",
                    background: "var(--hms-bg)",
                    border: "1px solid var(--hms-border)",
                    borderRadius: 3,
                    padding: "0 4px",
                  }}
                >
                  {entry.hash.slice(0, 7)}
                </span>
                <span style={{ fontSize: "0.65rem", color: "var(--hms-text-muted)", marginLeft: "auto" }}>
                  {entry.relative}
                </span>
              </div>
              <div
                style={{
                  fontSize: "var(--hms-text-xs)",
                  color: "var(--hms-text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.subject}
              </div>
              <div style={{ fontSize: "0.6rem", color: "var(--hms-text-muted)", marginTop: 1 }}>
                {f.historyBy} {entry.author}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const loadingStyle: React.CSSProperties = {
  padding: 12,
  fontSize: "var(--hms-text-xs)",
  color: "var(--hms-text-muted)",
};
