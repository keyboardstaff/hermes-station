import { useEffect, useRef, useState } from "react";
import { ChevronDown, Folder, CornerLeftUp, Check } from "lucide-react";
import {
  useWorkspaceDir, useWorkspaceSubdirs, useSetWorkspaceDir, type FileRoot,
} from "@/hooks/useFiles";
import type { Translations } from "@/i18n/types";

/**
 * WorkspacePathSwitcher — the file-browser root control. Replaces the old
 * register-a-workspace picker with upstream desktop's model: the `workspace`
 * root defaults to the user's home (`~/`); click the current folder name to open
 * a folder picker and switch which directory you're browsing — all confined
 * under home (option A). A `~/.hermes` toggle sits beside it.
 *
 * The picker is browse-then-commit: drilling into subfolders only updates the
 * in-popover path; "Use this folder" commits it (one tree reload), so it doesn't
 * thrash the tree on every click.
 */
export function WorkspacePathSwitcher({
  root, onSwitchRoot, f,
}: {
  root: FileRoot;
  onSwitchRoot: (r: FileRoot) => void;
  f: Translations["files"];
}) {
  const dirQ = useWorkspaceDir();
  const setDir = useSetWorkspaceDir();
  const [open, setOpen] = useState(false);
  const [navPath, setNavPath] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const isWorkspace = root === "workspace";
  const info = dirQ.data;

  // Drive the picker off `navPath` (the path being browsed), seeded from the
  // committed dir when opened.
  const nav = useWorkspaceSubdirs(open ? navPath : null);
  const crumbs = info && navPath ? buildCrumbs(info.home, navPath) : [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onFolderClick = () => {
    // From the hermes root, the first click just switches to the workspace root
    // (browse here); on the workspace root it toggles the folder picker — so a
    // click doesn't always force the dropdown open.
    if (!isWorkspace) { onSwitchRoot("workspace"); return; }
    if (open) { setOpen(false); return; }
    setNavPath(info?.dir ?? null);
    setOpen(true);
  };

  const commit = (path: string) => {
    setDir.mutate(path, {
      onSuccess: () => { if (!isWorkspace) onSwitchRoot("workspace"); setOpen(false); },
    });
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", gap: 'var(--hms-space-1)', minWidth: 0, flex: "0 1 auto" }}>
      <button
        type="button"
        onClick={() => onSwitchRoot("hermes")}
        title={f?.rootHermes ?? "~/.hermes"}
        style={chip(root === "hermes")}
      >
        .hermes
      </button>

      {/* Current workspace folder — sizes to its name; click to open the picker. */}
      <button
        type="button"
        onClick={onFolderClick}
        title={info?.dir ?? (f?.rootWorkspace ?? "~")}
        style={{
          ...chip(isWorkspace), minWidth: 0, maxWidth: 240, display: "flex", alignItems: "center",
          gap: 'var(--hms-space-1)', justifyContent: "flex-start", height: 24,
        }}
      >
        <Folder size={13} style={{ flexShrink: 0, color: isWorkspace ? "var(--hms-accent)" : "var(--hms-text-muted)" }} />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {info ? folderLabel(info.home, info.dir) : "~"}
        </span>
        <ChevronDown size={13} style={{ flexShrink: 0 }} />
      </button>

      {open && (
        <div
          className="hms-pop-in"
          style={{
            position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 9999,
            width: 280, maxWidth: "80vw", borderRadius: 'var(--hms-radius-md)',
            background: "var(--hms-surface)", border: "1px solid var(--hms-border)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.16)", overflow: "hidden",
            display: "flex", flexDirection: "column",
          }}
        >
          {/* Browsing breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "6px 10px", borderBottom: "1px solid var(--hms-border)", overflowX: "auto", whiteSpace: "nowrap" }}>
            {crumbs.map((c, i) => (
              <span key={c.path} style={{ display: "inline-flex", alignItems: "center" }}>
                {i > 0 && <span style={{ color: "var(--hms-text-muted)", margin: "0 1px" }}>/</span>}
                <button
                  type="button"
                  onClick={() => setNavPath(c.path)}
                  title={c.path}
                  style={{
                    border: "none", background: "none", padding: "1px 3px", cursor: "pointer",
                    color: i === crumbs.length - 1 ? "var(--hms-text)" : "var(--hms-text-muted)",
                    fontSize: 'var(--hms-text-caption)', fontWeight: i === crumbs.length - 1 ? 600 : 400,
                  }}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </div>

          {/* Subfolders */}
          <div style={{ maxHeight: 260, overflowY: "auto", padding: "4px 0" }}>
            {nav.data?.parent && (
              <button type="button" onClick={() => setNavPath(nav.data!.parent!)} style={menuItem}>
                <CornerLeftUp size={13} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />
                <span>..</span>
              </button>
            )}
            {(nav.data?.dirs ?? []).map((d) => (
              <button key={d.path} type="button" onClick={() => setNavPath(d.path)} style={menuItem}>
                <Folder size={13} style={{ flexShrink: 0, color: "var(--hms-accent)" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              </button>
            ))}
            {nav.data && nav.data.dirs.length === 0 && (
              <div style={{ padding: "6px 12px", color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-caption)' }}>
                {f?.noSubfolders ?? "No subfolders"}
              </div>
            )}
          </div>

          {/* Commit */}
          <button
            type="button"
            onClick={() => navPath && commit(navPath)}
            disabled={setDir.isPending || !navPath}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 'var(--hms-space-1)',
              padding: "7px 12px", border: "none", borderTop: "1px solid var(--hms-border)",
              background: "var(--hms-accent-weak)", color: "var(--hms-accent)",
              fontSize: 'var(--hms-text-sm)', fontWeight: 600, cursor: "pointer",
            }}
          >
            <Check size={13} /> {f?.useThisFolder ?? "Use this folder"}
          </button>
        </div>
      )}
    </div>
  );
}

/** A compact label for the current dir: `~` for home, else the folder name. */
function folderLabel(home: string, dir: string): string {
  const h = home.replace(/\/+$/, "");
  if (dir === h) return "~";
  const seg = dir.slice(dir.lastIndexOf("/") + 1);
  return seg || dir;
}

function buildCrumbs(home: string, dir: string): Array<{ label: string; path: string }> {
  const h = home.replace(/\/+$/, "");
  const crumbs: Array<{ label: string; path: string }> = [{ label: "~", path: h }];
  if (dir === h) return crumbs;
  const rest = dir.startsWith(h + "/") ? dir.slice(h.length + 1) : dir;
  let acc = h;
  for (const seg of rest.split("/").filter(Boolean)) {
    acc = `${acc}/${seg}`;
    crumbs.push({ label: seg, path: acc });
  }
  return crumbs;
}

function chip(active: boolean): React.CSSProperties {
  return {
    flexShrink: 0, display: "inline-flex", alignItems: "center", height: 24,
    border: `1px solid ${active ? "var(--hms-accent)" : "var(--hms-border)"}`,
    background: active ? "var(--hms-accent-weak)" : "var(--hms-surface)",
    color: active ? "var(--hms-accent)" : "var(--hms-text-muted)",
    borderRadius: 'var(--hms-radius-md)', padding: "0 8px", cursor: "pointer",
    fontSize: 'var(--hms-text-caption)', whiteSpace: "nowrap",
  };
}

const menuItem: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', width: "100%",
  padding: "6px 12px", border: "none", background: "none", cursor: "pointer",
  color: "var(--hms-text)", fontSize: 'var(--hms-text-sm)', textAlign: "left",
};
