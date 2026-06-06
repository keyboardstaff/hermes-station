import { useState, useCallback } from "react";
import { Eye, EyeOff, FilePlus2, FolderPlus } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  useWriteFile,
  useCreateDir,
  useGitInfo,
  type FileRoot,
} from "@/hooks/useFiles";
import { useFilesSelection } from "@/store/panel-selection";
import { WorkspacePathSwitcher } from "./WorkspacePathSwitcher";
import { TreeNode, type CreateState, type CreateProps } from "./FileTreeNode";

/**
 * sidebar file tree for ``/files``.
 *
 * Features:
 * - Show/hide hidden files (`.` prefix) toggle, persisted to localStorage.
 * - Inline new file / new folder creation via header icons or dir hover buttons.
 * - Selection lives in the ``useFilesSelection`` zustand store.
 *
 * The recursive node rendering lives in ``FileTreeNode``; the root/workspace
 * switcher in ``WorkspacePicker``.
 */
export default function FilesSideTree({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useI18n();
  const f = t.files;

  const root = useFilesSelection((s) => s.root);
  const setRoot = useFilesSelection((s) => s.setRoot);
  const selected = useFilesSelection((s) => s.selected);
  const setSelected = useFilesSelection((s) => s.setSelected);
  // Tree expansion is shared (store) so the chat-workspace tree and the /files
  // page tree render identically.
  const expanded = useFilesSelection((s) => s.expanded);
  const setExpanded = useFilesSelection((s) => s.setExpanded);

  const [showHidden, setShowHidden] = useState<boolean>(
    () => localStorage.getItem("hms:files-show-hidden") === "1",
  );
  const [activeCreate, setActiveCreate] = useState<CreateState | null>(null);

  const writeMut = useWriteFile();
  const mkdirMut = useCreateDir();
  const gitInfo = useGitInfo(root);

  const switchRoot = (r: FileRoot) => {
    if (r === root) return;
    setRoot(r); // store resets `expanded` on a root change
    setActiveCreate(null);
  };

  const toggleHidden = () =>
    setShowHidden((prev) => {
      const next = !prev;
      localStorage.setItem("hms:files-show-hidden", next ? "1" : "0");
      return next;
    });

  const handleToggle = useCallback((p: string) => {
    const next = new Set(expanded);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setExpanded(next);
  }, [expanded, setExpanded]);

  const handleSelectFile = useCallback(
    (p: string) => setSelected({ root, path: p }),
    [root, setSelected],
  );

  const handleCreateStart = useCallback(
    (parentPath: string, kind: "file" | "dir") => {
      if (parentPath) {
        // auto-expand target dir so inline input appears immediately
        const key = `${root}/${parentPath}`;
        if (!expanded.has(key)) {
          const next = new Set(expanded);
          next.add(key);
          setExpanded(next);
        }
      }
      setActiveCreate({ parentPath, kind });
    },
    [root, expanded, setExpanded],
  );

  const handleCreateConfirm = useCallback(
    async (name: string) => {
      if (!activeCreate || !name.trim()) return;
      const p = activeCreate.parentPath
        ? `${activeCreate.parentPath}/${name.trim()}`
        : name.trim();
      try {
        if (activeCreate.kind === "file") {
          await writeMut.mutateAsync({ root, path: p, content: "" });
          setSelected({ root, path: p });
        } else {
          await mkdirMut.mutateAsync({ root, path: p });
        }
      } catch {
        /* mutation error surfaced by react-query; close input cleanly */
      } finally {
        setActiveCreate(null);
      }
    },
    [activeCreate, root, writeMut, mkdirMut, setSelected],
  );

  const handleCreateCancel = useCallback(() => setActiveCreate(null), []);

  const labels = {
    loading: f?.loading ?? "Loading…",
    empty: f?.empty ?? "Empty",
    error: f?.errorTree ?? "Failed to load",
  };

  const createProps: CreateProps = {
    activeCreate,
    onCreateStart: handleCreateStart,
    onCreateConfirm: handleCreateConfirm,
    onCreateCancel: handleCreateCancel,
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--hms-space-2)",
        padding: embedded ? "var(--hms-space-2)" : "var(--hms-space-3)",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Single header row: root switch (hermes / workspace) on the left,
          git badge + file action icons on the right — keeps everything on
          one line to save vertical space. The page title is owned by the
          PageTopBar / drawer tab bar, so there's no <h2> here. */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-1)" }}>
        {/* Root control — ~/.hermes toggle + the `workspace` path switcher
            (default ~/, click a crumb or pick a subfolder to switch path). */}
        <WorkspacePathSwitcher root={root} onSwitchRoot={switchRoot} f={f} />

        <div style={{ flex: 1 }} />

        {gitInfo.data?.branch && (
          <span
            title={`git: ${gitInfo.data.branch}`}
            style={{
              fontSize: "0.6rem",
              fontFamily: "monospace",
              color: gitInfo.data.dirty ? "var(--hms-warn-text, #b45309)" : "var(--hms-text-muted)",
              background: "var(--hms-surface)",
              border: "1px solid var(--hms-border)",
              borderRadius: 4,
              padding: "1px 5px",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {gitInfo.data.branch}
            {(gitInfo.data.dirty ?? 0) > 0 && ` ·${gitInfo.data.dirty}Δ`}
            {(gitInfo.data.ahead ?? 0) > 0 && ` ↑${gitInfo.data.ahead}`}
            {(gitInfo.data.behind ?? 0) > 0 && ` ↓${gitInfo.data.behind}`}
          </span>
        )}
        <button
          title={showHidden ? (f?.hideHidden ?? "Hide hidden files") : (f?.showHidden ?? "Show hidden files")}
          onClick={toggleHidden}
          style={treeIconBtn(showHidden)}
        >
          {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        <button
          title={f?.newFile ?? "New file"}
          onClick={() => handleCreateStart("", "file")}
          style={treeIconBtn(false)}
        >
          <FilePlus2 size={14} />
        </button>
        <button
          title={f?.newFolder ?? "New folder"}
          onClick={() => handleCreateStart("", "dir")}
          style={treeIconBtn(false)}
        >
          <FolderPlus size={14} />
        </button>
      </div>

      {/* Tree — borderless/transparent in both page and drawer modes so the
          file browser looks identical wherever it's embedded. */}
      <div style={treeBodyStyle}>
        <TreeNode
          root={root}
          path=""
          depth={0}
          expanded={expanded}
          onToggle={handleToggle}
          onSelectFile={handleSelectFile}
          selected={selected}
          labels={labels}
          showHidden={showHidden}
          createProps={createProps}
          f={f}
          initiallyOpen
        />
      </div>
    </div>
  );
}

const treeBodyStyle: React.CSSProperties = { flex: 1, overflow: "auto", padding: 2 };

function treeIconBtn(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 6,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: active ? "var(--hms-accent)" : "var(--hms-text-muted)",
    flexShrink: 0,
  };
}
