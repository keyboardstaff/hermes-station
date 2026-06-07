import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  File as FileIcon,
  Save,
  Trash2,
  Pencil,
  Loader,
  AlertCircle,
  RefreshCw,
  Download,
  History,
  MoreHorizontal,
} from "lucide-react";
import { useI18n } from "@/i18n";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import {
  useFileRead,
  useWriteFile,
  useDeleteFile,
  useRenameFile,
  useGitInfo,
  type FileRoot,
} from "@/hooks/useFiles";
import { useFilesSelection } from "@/store/panel-selection";
import { apiErrorDetail } from "@/lib/errors";
import FileVersionHistory from "./FileVersionHistory";
import { guessLanguage } from "./language";

/**
 * Monaco-backed file editor for the `/files` page and the chat
 * `WorkspaceContextPanel`.
 *
 * `variant="page"` — fixed 540 px tall body, optional sidebar-mode
 * version history, shows the `<h2>` path heading + file meta. The
 * page tree provides path context.
 *
 * `variant="drawer"` — fills the remaining height (`flex: 1`), version
 * history replaces the editor body (panel mode), and the path heading
 * is omitted because the parent renders a `FileBreadcrumb` above.
 *
 * Button hierarchy:
 *   Save (primary) · ↻ Refresh (icon) · 🕘 History (icon)
 *   ⋯ More → Download / Rename / Delete (danger)
 */
export default function FileEditor({
  root,
  path,
  monacoTheme,
  onAfterDelete,
  variant = "page",
}: {
  root: FileRoot;
  path: string;
  monacoTheme: string;
  onAfterDelete: () => void;
  variant?: "page" | "drawer";
}) {
  const { t } = useI18n();
  const f = t.files;
  const readQuery = useFileRead(root, path, true);
  const writeMut = useWriteFile();
  const deleteMut = useDeleteFile();
  const renameMut = useRenameFile();
  const gitInfo = useGitInfo(root);
  const setSelected = useFilesSelection((s) => s.setSelected);

  const [draft, setDraft] = useState<string>("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (readQuery.data && !readQuery.data.binary) {
      setDraft(readQuery.data.content);
    }
  }, [readQuery.data]);

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

  const isBinary = readQuery.data?.binary === true;
  const original = readQuery.data && !readQuery.data.binary ? readQuery.data.content : "";
  const dirty = useMemo(() => !isBinary && draft !== original, [isBinary, draft, original]);

  const handleSave = async () => {
    setErr(null);
    try {
      await writeMut.mutateAsync({ root, path, content: draft });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
    } catch (e: unknown) {
      setErr(apiErrorDetail(e));
    }
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!window.confirm(`${f.confirmDelete} ${path}?`)) return;
    setErr(null);
    try {
      await deleteMut.mutateAsync({ root, path });
      onAfterDelete();
    } catch (e: unknown) {
      setErr(apiErrorDetail(e));
    }
  };

  const handleRename = async () => {
    setMenuOpen(false);
    const oldName = path.split("/").pop() ?? "";
    const next = window.prompt(f.renamePrompt, oldName);
    if (!next || next === oldName) return;
    setErr(null);
    try {
      const r = await renameMut.mutateAsync({ root, path, new_name: next });
      setSelected({ root, path: r.path });
    } catch (e: unknown) {
      setErr(apiErrorDetail(e));
    }
  };

  const handleDownload = () => {
    setMenuOpen(false);
    if (!readQuery.data) return;
    let blob: Blob;
    if (readQuery.data.binary) {
      const raw = atob(readQuery.data.content_b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      blob = new Blob([bytes]);
    } else {
      blob = new Blob([readQuery.data.content], { type: "text/plain" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = path.split("/").pop() ?? "download";
    a.click();
    URL.revokeObjectURL(url);
  };

  const isDrawer = variant === "drawer";
  const historyAvailable = !!gitInfo.data?.branch && !isBinary;

  const fileName = path.split("/").pop() || path;
  const rootStyle: React.CSSProperties = isDrawer
    ? { display: "flex", flexDirection: "column", gap: "var(--hms-space-2)", height: "100%", minHeight: 0 }
    : { display: "flex", flexDirection: "column", gap: "var(--hms-space-3)", flex: 1, minWidth: 0, height: "100%", minHeight: 0 };

  return (
    <div className="hms-file-editor" data-variant={isDrawer ? "drawer" : "page"}>
      {/* One compact toolbar: file name + meta (page) on the left, status, and
          the action buttons on the right. Drawer hides it while viewing history. */}
      {!(isDrawer && showHistory) && (
        <div className="hms-file-editor-toolbar" data-variant={isDrawer ? "drawer" : "page"}>
          {!isDrawer ? (
            <div title={path} className="hms-file-editor-filename-header">
              <span className="hms-file-editor-filename-name">{fileName}</span>
              <span className="hms-file-editor-filename-meta">
                {root}{readQuery.data ? ` · ${readQuery.data.size} ${f.bytes}` : ""}
              </span>
            </div>
          ) : (
            <div style={{ flex: 1, minWidth: 0 }} />
          )}

          {(err || savedFlash) && (
            <div className="hms-file-editor-status">
              {err && (
                <StatusPill kind="error">
                  <AlertCircle size={11} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{err}</span>
                </StatusPill>
              )}
              {savedFlash && <StatusPill kind="ok">✓ {f.saved}</StatusPill>}
            </div>
          )}

          <Button
            size="sm"
            variant="primary"
            onClick={handleSave}
            disabled={!dirty || writeMut.isPending || isBinary}
            style={{ opacity: dirty ? 1 : 0.5, cursor: dirty && !isBinary ? "pointer" : "default" }}
          >
            {writeMut.isPending ? <Loader size={12} className="hms-spin" /> : <Save size={12} />}
            {writeMut.isPending ? f.saving : f.save}
          </Button>

          <IconButton
            size="sm"
            aria-label={f.refresh}
            title={f.refresh}
            onClick={() => readQuery.refetch()}
          >
            <RefreshCw size={13} />
          </IconButton>

          {historyAvailable && (
            <IconButton
              size="sm"
              aria-label={f.historyTitle}
              title={f.historyTitle}
              active={showHistory}
              onClick={() => setShowHistory((v) => !v)}
            >
              <History size={13} />
            </IconButton>
          )}

          <div style={{ position: "relative" }} ref={menuRef}>
            <IconButton
              size="sm"
              aria-label={f.more}
              title={f.more}
              active={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <MoreHorizontal size={13} />
            </IconButton>
            {menuOpen && (
              <div role="menu" className="hms-file-editor-menu">
                <MenuItem icon={<Download size={13} />} label={f.download} onClick={handleDownload} disabled={!readQuery.data} />
                <MenuItem icon={<Pencil size={13} />} label={f.rename} onClick={handleRename} disabled={renameMut.isPending} />
                <MenuItem icon={<Trash2 size={13} />} label={f.delete} onClick={handleDelete} disabled={deleteMut.isPending} danger />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="hms-file-editor-body" data-variant={isDrawer ? "drawer" : "page"}>
        {isDrawer && showHistory ? (
          <FileVersionHistory
            root={root}
            path={path}
            monacoTheme={monacoTheme}
            onClose={() => setShowHistory(false)}
            variant="panel"
          />
        ) : (
          <>
            <div className="hms-file-editor-canvas">
              {readQuery.isLoading ? (
                <EditorState icon={<Loader size={24} className="hms-spin" />} text={f.loadingFile} />
              ) : readQuery.isError ? (
                <EditorState icon={<AlertCircle size={24} />} text={apiErrorDetail(readQuery.error)} tone="error" />
              ) : isBinary ? (
                <EditorState icon={<FileIcon size={24} />} text={f.binaryHint} />
              ) : (
                <Editor
                  height="100%"
                  theme={monacoTheme}
                  value={draft}
                  onChange={(v) => setDraft(v ?? "")}
                  language={guessLanguage(path)}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    wordWrap: "on",
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    lineNumbers: "on",
                    lineNumbersMinChars: 3,
                    lineDecorationsWidth: 4,
                    glyphMargin: false,
                    folding: false,
                    scrollbar: {
                      verticalScrollbarSize: 4,
                      horizontalScrollbarSize: 4,
                      useShadows: false,
                    },
                    overviewRulerLanes: 0,
                    overviewRulerBorder: false,
                    quickSuggestions: false,
                  }}
                />
              )}
            </div>
            {!isDrawer && showHistory && (
              <FileVersionHistory
                root={root}
                path={path}
                monacoTheme={monacoTheme}
                onClose={() => setShowHistory(false)}
                variant="sidebar"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EditorState({
  icon,
  text,
  tone = "muted",
}: {
  icon: React.ReactNode;
  text: string;
  tone?: "muted" | "error";
}) {
  const fg = tone === "error" ? "var(--hms-error-text)" : "var(--hms-text-muted)";
  const bg = tone === "error" ? "var(--hms-error-weak)" : "var(--hms-hover-bg)";
  return (
    <div style={loadingBox}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--hms-space-3)", textAlign: "center", padding: "var(--hms-space-6)", color: fg }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: bg }}>
          {icon}
        </div>
        <div style={{ fontSize: "var(--hms-text-sm)", lineHeight: 1.6 }}>{text}</div>
      </div>
    </div>
  );
}

// ── menu item ─────────────────────────────────────────────────────────

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="hms-sidebar-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--hms-space-2)",
        width: "100%",
        padding: "7px 12px",
        border: "none",
        background: "none",
        color: danger ? "var(--hms-error-text)" : "var(--hms-text)",
        fontSize: "var(--hms-text-sm)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        textAlign: "left",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ── status pill (error / saved) ───────────────────────────────────────

function StatusPill({
  kind,
  children,
}: {
  kind: "ok" | "error";
  children: React.ReactNode;
}) {
  const colors = kind === "error"
    ? { bg: "var(--hms-error-weak)", border: "var(--hms-error-border)", text: "var(--hms-error-text)" }
    : { bg: "var(--hms-success-weak)", border: "var(--hms-success-border)", text: "var(--hms-success-text)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--hms-space-1)",
        padding: "3px 8px",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        color: colors.text,
        fontSize: "var(--hms-text-caption)",
        maxWidth: 220,
      }}
    >
      {children}
    </span>
  );
}

const loadingBox: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "var(--hms-text-muted)",
  fontSize: "var(--hms-text-sm)",
};
