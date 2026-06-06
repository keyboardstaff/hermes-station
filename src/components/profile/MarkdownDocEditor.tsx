import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Save, Loader, Eye, Code, AlertCircle, Lock } from "lucide-react";
import Button from "@/components/ui/Button";
import { errorMessage } from "@/lib/errors";

/**
 * Shared Markdown document editor — Preview/Edit toggle + Monaco + Save,
 * with dirty/saved/error state. Extracted from the duplicated blocks that
 * previously lived in ProfilePanel (SOUL.md) and the old MemoryPanel
 * (MEMORY.md / USER.md); now the single home for all profile docs.
 *
 * The loaded ``content`` prop is the source of truth: the internal draft
 * resets whenever it changes (e.g. switching tab or profile), so callers
 * just swap the query result in.
 */
export default function MarkdownDocEditor({
  label,
  content,
  isLoading = false,
  onSave,
  isSaving = false,
  monacoTheme,
  pathHint,
  readOnly = false,
}: {
  label: string;
  content: string;
  isLoading?: boolean;
  onSave: (content: string) => Promise<void>;
  isSaving?: boolean;
  monacoTheme: string;
  pathHint?: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(content);
  const [mode, setMode] = useState<"preview" | "edit">("edit");
  const [savedFlash, setSavedFlash] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset the draft when the loaded content changes (tab/profile switch).
  useEffect(() => {
    setDraft(content);
    setErr(null);
  }, [content]);

  const dirty = useMemo(() => draft !== content, [draft, content]);

  const handleSave = async () => {
    setErr(null);
    try {
      await onSave(draft);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
    } catch (e: unknown) {
      setErr(errorMessage(e));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-2)", flex: 1, minHeight: 0 }}>
      {/* Toolbar: label + path hint + Preview/Edit toggle + Save */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--hms-space-2)" }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <span style={{ fontSize: "var(--hms-text-caption)", fontWeight: 600 }}>{label}</span>
          {pathHint && (
            <span style={{ fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pathHint}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)" }}>
          <div style={{ display: "flex", border: "1px solid var(--hms-border)", borderRadius: 6, overflow: "hidden" }}>
            <button
              type="button"
              title="Preview"
              onClick={() => setMode("preview")}
              style={toggleBtn(mode === "preview")}
            >
              <Eye size={11} />
            </button>
            <button
              type="button"
              title="Edit"
              onClick={() => setMode("edit")}
              style={{ ...toggleBtn(mode === "edit"), borderLeft: "1px solid var(--hms-border)" }}
            >
              <Code size={11} />
            </button>
          </div>
          {readOnly ? (
            <span style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-1)", fontSize: "var(--hms-text-caption)", color: "var(--hms-text-muted)" }}>
              <Lock size={12} /> Read-only
            </span>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={handleSave}
              disabled={!dirty || isSaving}
              style={{ opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "default" }}
            >
              {isSaving ? <Loader size={12} className="hms-spin" /> : <Save size={12} />}
              {isSaving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </div>

      {err && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-1)", padding: "6px 10px", background: "var(--hms-error-weak)", border: "1px solid var(--hms-error-border)", borderRadius: 6, color: "var(--hms-error-text)", fontSize: "var(--hms-text-caption)" }}>
          <AlertCircle size={12} />
          {err}
        </div>
      )}
      {savedFlash && (
        <div style={{ padding: "6px 10px", background: "var(--hms-success-weak)", border: "1px solid var(--hms-success-border)", borderRadius: 6, color: "var(--hms-success-text)", fontSize: "var(--hms-text-caption)" }}>
          ✓ Saved
        </div>
      )}

      <div style={{ flex: 1, minHeight: 320, border: "1px solid var(--hms-border)", borderRadius: 8, overflow: "hidden" }}>
        {isLoading ? (
          <div style={loadingBox}>Loading…</div>
        ) : mode === "preview" ? (
          <div
            className="skill-md-content"
            style={{ height: "100%", padding: 16, overflowY: "auto", boxSizing: "border-box", fontSize: "var(--hms-text-sm)", lineHeight: 1.6 }}
          >
            {/* Constrain reading width for long-form markdown. */}
            <div style={{ maxWidth: "var(--hms-content-max-w, 72ch)", margin: "0 auto" }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <Editor
            height="100%"
            defaultLanguage="markdown"
            theme={monacoTheme}
            value={draft}
            onChange={(v) => !readOnly && setDraft(v ?? "")}
            options={{
              readOnly,
              minimap: { enabled: false },
              wordWrap: "on",
              lineNumbers: "on",
              lineNumbersMinChars: 3,
              lineDecorationsWidth: 4,
              glyphMargin: false,
              folding: false,
              fontSize: 13,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              scrollbar: { verticalScrollbarSize: 4, horizontalScrollbarSize: 4, useShadows: false },
              overviewRulerLanes: 0,
              overviewRulerBorder: false,
            }}
          />
        )}
      </div>
    </div>
  );
}

function toggleBtn(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    background: active ? "var(--hms-text)" : "transparent",
    color: active ? "var(--hms-bg)" : "var(--hms-text-muted)",
    border: "none",
    cursor: "pointer",
  };
}

const loadingBox: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "var(--hms-text-muted)",
  fontSize: "var(--hms-text-sm)",
};
