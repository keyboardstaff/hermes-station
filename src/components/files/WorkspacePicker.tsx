import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, Trash2, FolderPlus } from "lucide-react";
import { type WorkspacesData } from "@/hooks/useWorkspaces";

// Workspace switcher dropdown, extracted from FilesSideTree.
// ~/.hermes, default ~/workspace, and custom workspaces in one picker;
// selection drives the file-tree root and (for workspaces) the agent's
// TERMINAL_CWD.

interface WorkspacePickerProps {
  root: "hermes" | "workspace";
  data: WorkspacesData | undefined;
  onSelectHermes: () => void;
  onSwitch: (id: string | null) => void;
  onAdd: (path: string, name: string) => Promise<unknown>;
  onRemove: (id: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  f: any;
}

export function WorkspacePicker({
  root,
  data,
  onSelectHermes,
  onSwitch,
  onAdd,
  onRemove,
  f,
}: WorkspacePickerProps) {
  const active = root === "workspace";
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, setAddPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Auto-focus path input when add form opens
  useEffect(() => {
    if (adding) pathInputRef.current?.focus();
  }, [adding]);

  const activeId = data?.active_id ?? null;
  const workspaces = data?.workspaces ?? [];
  const activeWs = workspaces.find((w) => w.id === activeId);
  const label = root === "hermes"
    ? (f?.rootHermes ?? "~/.hermes")
    : (activeWs?.name ?? f?.rootWorkspace ?? "~/workspace");

  const handleAdd = async () => {
    if (!newPath.trim()) return;
    setAddError(null);
    setAddPending(true);
    try {
      await onAdd(newPath.trim(), newName.trim());
      setNewPath("");
      setNewName("");
      setAdding(false);
    } catch (err: unknown) {
      const msg = (err as { error?: string })?.error ?? "error";
      const errMap: Record<string, string> = {
        already_exists: f?.workspaceAlreadyExists ?? "Already added.",
        not_found: f?.workspaceNotFound ?? "Path not found.",
        system_path: f?.workspaceSystemPath ?? "Cannot use a system directory.",
      };
      setAddError(errMap[msg] ?? msg);
    } finally {
      setAddPending(false);
    }
  };

  const pillStyle: React.CSSProperties = {
    padding: "3px 8px",
    fontSize: "0.625rem",
    borderRadius: 6,
    border: "1px solid var(--hms-border)",
    background: "var(--hms-input-bg)",
    color: "var(--hms-text)",
    fontFamily: "monospace",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 4,
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
  };

  const optionRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    padding: "5px 10px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: "0.65rem",
    color: "var(--hms-text)",
    textAlign: "left",
  };

  return (
    <div ref={containerRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <button
        style={pillStyle}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{label}</span>
        <ChevronDown size={9} style={{ flexShrink: 0 }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--hms-bg)",
            border: "1px solid var(--hms-border)",
            borderRadius: 8,
            boxShadow: "var(--hms-shadow-popover)",
            zIndex: 100,
            padding: "6px 0",
            minWidth: 220,
          }}
        >
          {/* ~/.hermes root — active when it's both the browse root and the
              agent cwd (the "hermes" sentinel). */}
          <button
            onClick={() => { onSelectHermes(); setOpen(false); }}
            style={optionRowStyle}
          >
            <Check
              size={10}
              style={{ opacity: root === "hermes" && activeId === "hermes" ? 1 : 0, color: "var(--hms-accent)", flexShrink: 0 }}
            />
            <span style={{ fontFamily: "monospace", flex: 1 }}>
              {f?.rootHermes ?? "~/.hermes"}
            </span>
          </button>

          {/* ~/workspace (default) */}
          <button
            onClick={() => { onSwitch(null); setOpen(false); }}
            style={optionRowStyle}
          >
            <Check
              size={10}
              style={{ opacity: active && activeId === null ? 1 : 0, color: "var(--hms-accent)", flexShrink: 0 }}
            />
            <span style={{ fontFamily: "monospace", flex: 1 }}>
              {f?.rootWorkspace ?? "~/workspace"}
            </span>
          </button>

          {/* Custom workspaces */}
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0 6px 0 10px",
                gap: 4,
              }}
            >
              <button
                onClick={() => { onSwitch(ws.id); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "0.65rem",
                  color: "var(--hms-text)",
                  textAlign: "left",
                  padding: "5px 4px 5px 0",
                  minWidth: 0,
                }}
              >
                <Check
                  size={10}
                  style={{ opacity: active && activeId === ws.id ? 1 : 0, color: "var(--hms-accent)", flexShrink: 0 }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {ws.name}
                </span>
              </button>
              <button
                title="Remove"
                onClick={(e) => { e.stopPropagation(); onRemove(ws.id); }}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 3, lineHeight: 0, color: "var(--hms-text-muted)", flexShrink: 0 }}
              >
                <Trash2 size={9} />
              </button>
            </div>
          ))}

          <div style={{ borderTop: "1px solid var(--hms-border)", margin: "4px 0" }} />

          {/* Add form / Add button */}
          {adding ? (
            <div style={{ padding: "4px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
              <input
                ref={pathInputRef}
                value={newPath}
                onChange={(e) => { setNewPath(e.target.value); setAddError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
                placeholder={f?.workspacePath ?? "Path"}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "1px solid var(--hms-border)",
                  borderRadius: 4,
                  outline: "none",
                  color: "var(--hms-text)",
                  fontSize: "0.625rem",
                  padding: "3px 6px",
                  boxSizing: "border-box",
                }}
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
                placeholder={f?.workspaceName ?? "Name (optional)"}
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "1px solid var(--hms-border)",
                  borderRadius: 4,
                  outline: "none",
                  color: "var(--hms-text)",
                  fontSize: "0.625rem",
                  padding: "3px 6px",
                  boxSizing: "border-box",
                }}
              />
              {addError && (
                <span style={{ fontSize: "0.55rem", color: "var(--hms-error-text)" }}>{addError}</span>
              )}
              <div style={{ display: "flex", gap: 'var(--hms-space-1)' }}>
                <button
                  onClick={handleAdd}
                  disabled={addPending || !newPath.trim()}
                  style={{
                    flex: 1,
                    padding: "3px 6px",
                    border: "none",
                    borderRadius: 4,
                    background: "var(--hms-accent)",
                    color: "var(--hms-on-accent)",
                    cursor: "pointer",
                    fontSize: "0.6rem",
                    opacity: addPending ? 0.6 : 1,
                  }}
                >
                  {addPending ? "…" : (f?.workspaceAdd ?? "Add")}
                </button>
                <button
                  onClick={() => { setAdding(false); setAddError(null); }}
                  style={{
                    padding: "3px 6px",
                    border: "1px solid var(--hms-border)",
                    borderRadius: 4,
                    background: "transparent",
                    color: "var(--hms-text-muted)",
                    cursor: "pointer",
                    fontSize: "0.6rem",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setAdding(true); setNewPath(""); setNewName(""); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "5px 10px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: "0.65rem",
                color: "var(--hms-text-muted)",
                textAlign: "left",
              }}
            >
              <FolderPlus size={10} style={{ flexShrink: 0 }} />
              {f?.workspaceAdd ?? "Add workspace…"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
