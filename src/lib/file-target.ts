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

/** True when the last path segment has a file extension — i.e. it looks like a
 *  file (`docs/x.md`) rather than a directory (`skills/yuanbao`). Used to gate
 *  the document preview so a directory path never hits `/api/files/read` (400). */
export function hasFileExtension(value: string): boolean {
  const clean = value.split(/[?#]/)[0].replace(/\/+$/, "");
  const seg = clean.slice(clean.lastIndexOf("/") + 1);
  return /\.[A-Za-z0-9]+$/.test(seg);
}

/** Normalise an absolute path, collapsing `.`/`..` segments. */
function normalizeAbs(p: string): string {
  const stack: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return "/" + stack.join("/");
}

/**
 * Map an artifact's path to a Files-page target. Absolute paths map directly;
 * a relative path (`./x`, `../x`, `x/y`) resolves against `cwd` when that's a
 * recorded absolute dir. Returns null for paths outside both whitelisted roots
 * (`~/.hermes`, a registered workspace) — those can't be read by the file API.
 */
export function resolveFileTarget(
  value: string,
  workspaces: WorkspaceDir[],
  cwd?: string,
): FileTarget | null {
  let p = value;
  if (p.startsWith("file://")) {
    const rest = p.slice("file://".length);
    try { p = decodeURI(rest); } catch { p = rest; }
  }

  if (!p.startsWith("/")) {
    // Relative — resolve against the session cwd when it's a real abs dir.
    if (!cwd || !cwd.startsWith("/")) return null;
    p = normalizeAbs(`${cwd.replace(/\/+$/, "")}/${p}`);
  } else {
    p = normalizeAbs(p);
  }

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
