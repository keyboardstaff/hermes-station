import { useState, useEffect, useRef } from "react";
import {
  Folder,
  File as FileIcon,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { useFileTree, type FileRoot, type FsEntry } from "@/hooks/useFiles";
import { type FileSelection } from "@/store/panel-selection";

// Recursive file-tree node cluster (TreeNode ↔ TreeEntry, plus the inline
// new-item input), extracted from FilesSideTree. The lazy
// per-directory ``useFileTree`` query lives at the node level so each expanded
// folder fetches its own children.

export interface CreateState {
  parentPath: string;
  kind: "file" | "dir";
}

export interface CreateProps {
  activeCreate: CreateState | null;
  onCreateStart: (parentPath: string, kind: "file" | "dir") => void;
  onCreateConfirm: (name: string) => Promise<void>;
  onCreateCancel: () => void;
  onDelete: (path: string, kind: "file" | "dir") => void;
}

interface TreeSharedProps {
  root: FileRoot;
  depth: number;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  onSelectFile: (p: string) => void;
  selected: FileSelection | null;
  labels: { loading: string; empty: string; error: string };
  showHidden: boolean;
  createProps: CreateProps;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  f: any;
}

export function TreeNode({
  root,
  path,
  depth,
  expanded,
  onToggle,
  onSelectFile,
  selected,
  labels,
  showHidden,
  createProps,
  f,
  initiallyOpen,
}: TreeSharedProps & { path: string; initiallyOpen?: boolean }) {
  const isOpen = initiallyOpen || expanded.has(`${root}/${path}`);
  const treeQuery = useFileTree(root, path);

  if (!isOpen) return null;

  if (treeQuery.isLoading) {
    return (
      <div style={{ paddingLeft: depth * 12 + 8, fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)" }}>
        {labels.loading}
      </div>
    );
  }

  if (treeQuery.isError || treeQuery.data?.error) {
    return (
      <div style={{ paddingLeft: depth * 12 + 8, fontSize: "var(--hms-text-xs)", color: "var(--hms-error-text)" }}>
        {treeQuery.data?.error || labels.error}
      </div>
    );
  }

  const allEntries = treeQuery.data?.entries ?? [];
  const entries = showHidden
    ? allEntries
    : allEntries.filter((e) => !e.name.startsWith("."));

  const showInline = createProps.activeCreate?.parentPath === path;

  if (entries.length === 0 && !showInline) {
    return (
      <div style={{ paddingLeft: depth * 12 + 8, fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)" }}>
        {labels.empty}
      </div>
    );
  }

  const shared: TreeSharedProps = {
    root,
    depth,
    expanded,
    onToggle,
    onSelectFile,
    selected,
    labels,
    showHidden,
    createProps,
    f,
  };

  return (
    <div>
      {entries.map((entry) => (
        <TreeEntry
          key={entry.name}
          {...shared}
          parentPath={path}
          entry={entry}
        />
      ))}
      {showInline && (
        <NewItemRow
          kind={createProps.activeCreate!.kind}
          depth={depth + 1}
          onConfirm={createProps.onCreateConfirm}
          onCancel={createProps.onCreateCancel}
          f={f}
        />
      )}
    </div>
  );
}

// ── Tree entry (dir + file) ──────────────────────────────────────────

function TreeEntry({
  root,
  parentPath,
  entry,
  depth,
  expanded,
  onToggle,
  onSelectFile,
  selected,
  labels,
  showHidden,
  createProps,
  f,
}: TreeSharedProps & { parentPath: string; entry: FsEntry }) {
  const [hovered, setHovered] = useState(false);
  const childPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  const isExpanded = expanded.has(`${root}/${childPath}`);
  const isSelected =
    selected !== null && selected.root === root && selected.path === childPath;

  const shared: TreeSharedProps = {
    root,
    depth: depth + 1,
    expanded,
    onToggle,
    onSelectFile,
    selected,
    labels,
    showHidden,
    createProps,
    f,
  };

  if (entry.kind === "dir") {
    return (
      <div>
        <div
          className="hms-tree-row"
          data-active={false}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            onClick={() => onToggle(`${root}/${childPath}`)}
            className="hms-tree-row-btn"
            style={{ paddingLeft: depth * 12 + 4 }}
          >
            {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {isExpanded ? (
              <FolderOpen size={11} style={{ color: "var(--hms-accent)", flexShrink: 0 }} />
            ) : (
              <Folder size={11} style={{ color: "var(--hms-accent)", flexShrink: 0 }} />
            )}
            <span className="hms-tree-row-name">{entry.name}</span>
          </button>
          {hovered && (
            <>
              <button
                title={f?.newFile ?? "New file"}
                onClick={(e) => { e.stopPropagation(); createProps.onCreateStart(childPath, "file"); }}
                className="hms-tree-icon-btn"
              >
                <FilePlus size={10} />
              </button>
              <button
                title={f?.newFolder ?? "New folder"}
                onClick={(e) => { e.stopPropagation(); createProps.onCreateStart(childPath, "dir"); }}
                className="hms-tree-icon-btn"
              >
                <FolderPlus size={10} />
              </button>
              <button
                title={f?.delete ?? "Delete"}
                onClick={(e) => { e.stopPropagation(); createProps.onDelete(childPath, "dir"); }}
                className="hms-tree-icon-btn"
              >
                <Trash2 size={10} />
              </button>
            </>
          )}
        </div>
        {isExpanded && (
          <TreeNode
            {...shared}
            path={childPath}
            initiallyOpen
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="hms-tree-row"
      data-active={isSelected}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={() => onSelectFile(childPath)}
        className="hms-tree-row-btn hms-tree-row-btn--file"
        style={{ paddingLeft: depth * 12 + 17 }}
      >
        <FileIcon size={11} style={{ color: "var(--hms-text-muted)", flexShrink: 0 }} />
        <span className="hms-tree-row-name">{entry.name}</span>
      </button>
      {hovered && (
        <button
          title={f?.delete ?? "Delete"}
          onClick={(e) => { e.stopPropagation(); createProps.onDelete(childPath, "file"); }}
          className="hms-tree-icon-btn"
        >
          <Trash2 size={10} />
        </button>
      )}
    </div>
  );
}

// ── Inline new-item input ────────────────────────────────────────────

function NewItemRow({
  kind,
  depth,
  onConfirm,
  onCancel,
  f,
}: {
  kind: "file" | "dir";
  depth: number;
  onConfirm: (name: string) => Promise<void>;
  onCancel: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  f: any;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    if (name.trim()) onConfirm(name.trim());
  };

  return (
    <div className="hms-tree-new-item" style={{ paddingLeft: depth * 12 + 4 }}>
      {kind === "dir" ? (
        <FolderPlus size={11} style={{ color: "var(--hms-accent)", flexShrink: 0 }} />
      ) : (
        <FilePlus size={11} style={{ color: "var(--hms-text-muted)", flexShrink: 0 }} />
      )}
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder={kind === "dir" ? (f?.newFolder ?? "Folder name…") : (f?.newFile ?? "File name…")}
        className="hms-tree-new-item-input"
      />
      <button onClick={submit} className="hms-tree-icon-btn">
        <Check size={11} />
      </button>
      <button onClick={onCancel} className="hms-tree-icon-btn">
        <X size={11} />
      </button>
    </div>
  );
}
