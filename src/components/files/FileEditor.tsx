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

  const rootStyle: React.CSSProperties = isDrawer
    ? { display: "flex", flexDirection: "column", gap: "var(--hms-space-2)", height: "100%", minHeight: 0 }
    : { display: "flex", flexDirection: "column", gap: "var(--hms-space-4)" };

  return (
    <div style={rootStyle}>
      {!isDrawer && (
        <div>
          <h2
            title={path}
            style={{
              margin: 0,
              fontSize: "var(--hms-text-md)",
              fontWeight: 600,
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {path}
          </h2>
          <div style={{ fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)", marginTop: 4 }}>
            {root}
            {readQuery.data && (
              <>
                {" · "}
                {readQuery.data.size} {f.bytes}
                {readQuery.data.binary && <> · {f.binaryNote}</>}
              </>
            )}
          </div>
        </div>
      )}

      {/* In drawer mode, hide the button row while viewing history to
          keep the focus on the diff. Page mode keeps buttons visible
          because the history sidebar coexists with the editor. */}
      {!(isDrawer && showHistory) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--hms-space-2)",
            padding: isDrawer ? "0 var(--hms-space-3)" : 0,
            flexShrink: 0,
          }}
        >
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
            label={f.refresh}
            onClick={() => readQuery.refetch()}
          >
            <RefreshCw size={13} />
          </IconButton>

          {historyAvailable && (
            <IconButton
              label={f.historyTitle}
              active={showHistory}
              onClick={() => setShowHistory((v) => !v)}
            >
              <History size={13} />
            </IconButton>
          )}

          {/* Status messages live in the same row to save vertical space
              in the drawer; in page mode they wrap to the next line. */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-end", gap: "var(--hms-space-2)" }}>
            {err && (
              <StatusPill kind="error">
                <AlertCircle size={11} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{err}</span>
              </StatusPill>
            )}
            {savedFlash && <StatusPill kind="ok">✓ {f.saved}</StatusPill>}
          </div>

          <div style={{ position: "relative" }} ref={menuRef}>
            <IconButton
              label={f.more}
              active={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <MoreHorizontal size={13} />
            </IconButton>
            {menuOpen && (
              <div
                role="menu"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 4px)",
                  zIndex: 50,
                  background: "var(--hms-surface)",
                  border: "1px solid var(--hms-border)",
                  borderRadius: 8,
                  padding: "4px 0",
                  minWidth: 160,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                }}
              >
                <MenuItem icon={<Download size={13} />} label={f.download} onClick={handleDownload} disabled={!readQuery.data} />
                <MenuItem icon={<Pencil size={13} />} label={f.rename} onClick={handleRename} disabled={renameMut.isPending} />
                <MenuItem icon={<Trash2 size={13} />} label={f.delete} onClick={handleDelete} disabled={deleteMut.isPending} danger />
              </div>
            )}
          </div>
        </div>
      )}

      <div
        style={
          isDrawer
            ? {
                flex: 1,
                minHeight: 0,
                display: "flex",
                overflow: "hidden",
              }
            : {
                display: "flex",
                gap: 12,
                height: 540,
                border: "1px solid var(--hms-border)",
                borderRadius: 8,
                overflow: "hidden",
              }
        }
      >
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
            <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
              {readQuery.isLoading ? (
                <div style={loadingBox}>{f.loadingFile}</div>
              ) : isBinary ? (
                <div style={{ ...loadingBox, flexDirection: "column", gap: "var(--hms-space-2)" }}>
                  <FileIcon size={32} />
                  <div>{f.binaryHint}</div>
                </div>
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

// ── icon-only button (Refresh / History / More) ───────────────────────

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        border: "none",
        borderRadius: 6,
        background: active ? "var(--hms-surface-hover, var(--hms-hover-bg))" : "transparent",
        color: active ? "var(--hms-text)" : "var(--hms-text-muted)",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--hms-space-2)",
        width: "100%",
        padding: "7px 12px",
        border: "none",
        background: "none",
        color: danger ? "var(--hms-error-text, #e53e3e)" : "var(--hms-text)",
        fontSize: "var(--hms-text-sm)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        textAlign: "left",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "var(--hms-surface-hover, var(--hms-hover-bg))"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
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
    ? { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.18)", text: "var(--hms-error-text)" }
    : { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.20)", text: "var(--hms-success-text)" };
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
