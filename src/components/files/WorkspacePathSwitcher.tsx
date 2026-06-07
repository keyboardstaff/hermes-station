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
    <div ref={ref} className="hms-ws-picker">
      <button
        type="button"
        onClick={() => onSwitchRoot("hermes")}
        title={f?.rootHermes ?? "~/.hermes"}
        className="hms-ws-picker-chip"
        data-active={root === "hermes"}
      >
        .hermes
      </button>

      {/* Current workspace folder — sizes to its name; click to open the picker. */}
      <button
        type="button"
        onClick={onFolderClick}
        title={info?.dir ?? (f?.rootWorkspace ?? "~")}
        className="hms-ws-picker-chip hms-ws-picker-chip--folder"
        data-active={isWorkspace}
      >
        <Folder size={13} style={{ flexShrink: 0, color: isWorkspace ? "var(--hms-accent)" : "var(--hms-text-muted)" }} />
        <span className="hms-ws-picker-chip-label">
          {info ? folderLabel(info.home, info.dir) : "~"}
        </span>
        <ChevronDown size={13} style={{ flexShrink: 0 }} />
      </button>

      {open && (
        <div className="hms-ws-picker-popover hms-pop-in">
          {/* Browsing breadcrumb */}
          <div className="hms-ws-picker-crumbs">
            {crumbs.map((c, i) => (
              <span key={c.path} className="hms-ws-picker-crumb-item">
                {i > 0 && <span className="hms-ws-picker-crumb-sep">/</span>}
                <button
                  type="button"
                  onClick={() => setNavPath(c.path)}
                  title={c.path}
                  className="hms-ws-picker-crumb-btn"
                  data-active={i === crumbs.length - 1}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </div>

          {/* Subfolders */}
          <div className="hms-ws-picker-dirs">
            {nav.data?.parent && (
              <button type="button" onClick={() => setNavPath(nav.data!.parent!)} className="hms-ws-picker-menu-item">
                <CornerLeftUp size={13} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />
                <span>..</span>
              </button>
            )}
            {(nav.data?.dirs ?? []).map((d) => (
              <button key={d.path} type="button" onClick={() => setNavPath(d.path)} className="hms-ws-picker-menu-item">
                <Folder size={13} style={{ flexShrink: 0, color: "var(--hms-accent)" }} />
                <span className="hms-ws-picker-dir-name">{d.name}</span>
              </button>
            ))}
            {nav.data && nav.data.dirs.length === 0 && (
              <div className="hms-ws-picker-empty">
                {f?.noSubfolders ?? "No subfolders"}
              </div>
            )}
          </div>

          {/* Commit */}
          <button
            type="button"
            onClick={() => navPath && commit(navPath)}
            disabled={setDir.isPending || !navPath}
            className="hms-ws-picker-commit"
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
