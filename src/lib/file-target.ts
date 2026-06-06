/**
 * Resolve an artifact's absolute path to a Files-page target (`root` + relative
 * `path`), so a file artifact can open in Station's file preview the same way a
 * link opens in a new tab. The Files API whitelists two roots — `hermes`
 * (`~/.hermes`) and `workspace` (a registered workspace dir) — and takes a
 * root-relative path, so we map the absolute path onto whichever root contains
 * it. Returns null for relative paths or paths outside both roots (unresolvable,
 * so the artifact stays a plain, non-clickable label).
 */

import type { FileRoot } from "@/hooks/useFiles";

export interface FileTarget {
  root: FileRoot;
  path: string;
}

export interface WorkspaceDir {
  path: string;
}

const HERMES_MARK = "/.hermes/";

export function resolveFileTarget(value: string, workspaces: WorkspaceDir[]): FileTarget | null {
  let p = value;
  if (p.startsWith("file://")) {
    const rest = p.slice("file://".length);
    try { p = decodeURI(rest); } catch { p = rest; }
  }
  // Only absolute local paths resolve to a root.
  if (!p.startsWith("/")) return null;
  p = p.replace(/\/+$/, "") || "/";

  // ~/.hermes → the `hermes` root.
  if (p.endsWith("/.hermes")) return { root: "hermes", path: "" };
  const h = p.indexOf(HERMES_MARK);
  if (h !== -1) return { root: "hermes", path: p.slice(h + HERMES_MARK.length) };

  // A registered workspace directory → the `workspace` root.
  for (const ws of workspaces) {
    const base = (ws.path || "").replace(/\/+$/, "");
    if (!base) continue;
    if (p === base) return { root: "workspace", path: "" };
    if (p.startsWith(base + "/")) return { root: "workspace", path: p.slice(base.length + 1) };
  }

  return null;
}
