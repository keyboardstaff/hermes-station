import { useEffect, useRef, useState } from "react";
import { ChevronDown, Folder, ArrowUp } from "lucide-react";
import {
  useWorkspaceDir, useWorkspaceSubdirs, useSetWorkspaceDir, type FileRoot,
} from "@/hooks/useFiles";
import type { Translations } from "@/i18n/types";

/**
 * WorkspacePathSwitcher — the file-browser root control. Replaces the old
 * register-a-workspace picker with upstream desktop's model: the `workspace`
 * root defaults to the user's home (`~/`) and you switch which directory you're
 * browsing by clicking a path crumb (jump up) or picking a subfolder (drill in)
 * — all confined under home (option A). A `~/.hermes` toggle sits beside it.
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
  const ref = useRef<HTMLDivElement>(null);
  const isWorkspace = root === "workspace";
  const info = dirQ.data;
  const crumbs = info ? buildCrumbs(info.home, info.dir) : [];
  const subdirsQ = useWorkspaceSubdirs(open && info ? info.dir : null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = (path: string) => {
    setDir.mutate(path, {
      onSuccess: () => { if (!isWorkspace) onSwitchRoot("workspace"); setOpen(false); },
    });
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", gap: 'var(--hms-space-1)', minWidth: 0, flex: 1 }}>
      <button
        type="button"
        onClick={() => onSwitchRoot("hermes")}
        title={f?.rootHermes ?? "~/.hermes"}
        style={chip(root === "hermes")}
      >
        {f?.rootHermes ?? "~/.hermes"}
      </button>

      {/* Workspace path breadcrumb (scrollable) + subfolder drill-down. */}
      <div
        onClick={() => { if (!isWorkspace) onSwitchRoot("workspace"); }}
        style={{
          display: "flex", alignItems: "center", gap: 'var(--hms-space-1)', minWidth: 0, flex: 1,
          padding: "2px 4px", borderRadius: 'var(--hms-radius-sm)',
          background: isWorkspace ? "var(--hms-selected-bg)" : "transparent",
          cursor: isWorkspace ? "default" : "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", minWidth: 0, overflowX: "auto", whiteSpace: "nowrap" }}>
          {crumbs.map((c, i) => (
            <span key={c.path} style={{ display: "inline-flex", alignItems: "center" }}>
              {i > 0 && <span style={{ color: "var(--hms-text-muted)", margin: "0 2px" }}>/</span>}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); go(c.path); }}
                title={c.path}
                style={{
                  border: "none", background: "none", padding: "1px 3px", cursor: "pointer",
                  color: i === crumbs.length - 1 ? "var(--hms-text)" : "var(--hms-text-muted)",
                  fontSize: 'var(--hms-text-caption)', fontWeight: i === crumbs.length - 1 ? 600 : 400,
                  whiteSpace: "nowrap",
                }}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          title={f?.switchFolder ?? "Switch folder"}
          aria-label={f?.switchFolder ?? "Switch folder"}
          style={{ display: "inline-flex", flexShrink: 0, border: "none", background: "none", cursor: "pointer", color: "var(--hms-text-muted)", padding: 0 }}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {open && (
        <div
          style={{
            position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 9999,
            minWidth: 200, maxWidth: 320, maxHeight: 320, overflowY: "auto", padding: "4px 0",
            borderRadius: 'var(--hms-radius-md)', background: "var(--hms-surface)",
            border: "1px solid var(--hms-border)", boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          {subdirsQ.data?.parent && (
            <button type="button" onClick={() => go(subdirsQ.data!.parent!)} style={menuItem}>
              <ArrowUp size={13} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />
              <span>..</span>
            </button>
          )}
          {(subdirsQ.data?.dirs ?? []).map((d) => (
            <button key={d.path} type="button" onClick={() => go(d.path)} style={menuItem}>
              <Folder size={13} style={{ flexShrink: 0, color: "var(--hms-accent)" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
            </button>
          ))}
          {subdirsQ.data && subdirsQ.data.dirs.length === 0 && !subdirsQ.data.parent && (
            <div style={{ padding: "6px 12px", color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-caption)' }}>
              {f?.noSubfolders ?? "No subfolders"}
            </div>
          )}
        </div>
      )}
    </div>
  );
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
    flexShrink: 0, border: `1px solid ${active ? "var(--hms-accent)" : "var(--hms-border)"}`,
    background: active ? "var(--hms-accent-weak)" : "var(--hms-surface)",
    color: active ? "var(--hms-accent)" : "var(--hms-text-muted)",
    borderRadius: 'var(--hms-radius-sm)', padding: "2px 8px", cursor: "pointer",
    fontSize: 'var(--hms-text-caption)', whiteSpace: "nowrap",
  };
}

const menuItem: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', width: "100%",
  padding: "6px 12px", border: "none", background: "none", cursor: "pointer",
  color: "var(--hms-text)", fontSize: 'var(--hms-text-sm)', textAlign: "left",
};
