import { useState } from "react";
import Editor from "@monaco-editor/react";
import { History, X, ChevronLeft } from "lucide-react";
import { useI18n } from "@/i18n";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
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
  const wrapperClassName = [
    "hms-file-history",
    variant === "sidebar" ? "hms-file-history--sidebar" : "hms-file-history--panel",
  ].join(" ");

  return (
    <div className={wrapperClassName}>
      <div className="hms-file-history-toolbar">
        <History size={12} style={{ color: "var(--hms-text-muted)" }} />
        <span className="hms-file-history-title">{f.historyTitle}</span>
        <IconButton
          onClick={onClose}
          aria-label={f.backToFile}
          title={f.backToFile}
          size="sm"
        >
          <X size={13} />
        </IconButton>
      </div>

      {selectedRef ? (
        <div className="hms-file-history-pane">
          <div className="hms-file-history-subbar">
            <Button type="button" size="sm" onClick={() => setSelectedRef(null)}>
              <ChevronLeft size={11} />
              {t.common.back}
            </Button>
            <span className="hms-file-history-ref">{selectedRef.slice(0, 7)}</span>
          </div>
          <div className="hms-file-history-editor">
            {showQuery.isLoading ? (
              <div className="hms-file-history-loading">{f.loading}</div>
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
        <div className="hms-file-history-scroll">
          {logQuery.isLoading && <div className="hms-file-history-loading">{f.loading}</div>}
          {!logQuery.isLoading && entries.length === 0 && (
            <div className="hms-file-history-loading">{f.historyEmpty}</div>
          )}
          {entries.map((entry) => (
            <button
              key={entry.hash}
              type="button"
              onClick={() => setSelectedRef(entry.hash)}
              title={f.historyViewAt}
              className="hms-file-history-entry"
            >
              <div className="hms-file-history-entry-meta">
                <span className="hms-file-history-hash">{entry.hash.slice(0, 7)}</span>
                <span className="hms-file-history-relative">{entry.relative}</span>
              </div>
              <div className="hms-file-history-subject">{entry.subject}</div>
              <div className="hms-file-history-author">{f.historyBy} {entry.author}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
