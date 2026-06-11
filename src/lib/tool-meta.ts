// Friendly tool-row metadata, ported from upstream desktop's TOOL_META
// (tool-fallback-model.ts): per-tool done/pending titles + an icon, with the
// same prefix fallbacks (browser_/web_ → globe) and snake_case → Title Case
// humanization for unknown tools. Icons map desktop's codicons to lucide.

import type { LucideIcon } from "lucide-react";
import {
  Eye, FileDiff, FileText, Files, Globe, HelpCircle, Image as ImageIcon,
  Search, SquarePen, Terminal, Watch, Wrench,
} from "lucide-react";

export interface ToolMeta {
  done: string;
  pending: string;
  icon: LucideIcon;
}

const TOOL_META: Record<string, ToolMeta> = {
  browser_click: { done: "Clicked page element", pending: "Clicking page element", icon: Globe },
  browser_fill: { done: "Filled form field", pending: "Filling form field", icon: Globe },
  browser_navigate: { done: "Opened page", pending: "Opening page", icon: Globe },
  browser_snapshot: { done: "Captured page snapshot", pending: "Capturing page snapshot", icon: Globe },
  browser_take_screenshot: { done: "Captured screenshot", pending: "Capturing screenshot", icon: ImageIcon },
  browser_type: { done: "Typed on page", pending: "Typing on page", icon: Globe },
  clarify: { done: "Asked a question", pending: "Asking a question", icon: HelpCircle },
  cronjob: { done: "Cron job", pending: "Scheduling cron job", icon: Watch },
  edit_file: { done: "Edited file", pending: "Editing file", icon: SquarePen },
  execute_code: { done: "Ran code", pending: "Running code", icon: Terminal },
  image_generate: { done: "Generated image", pending: "Generating image", icon: ImageIcon },
  list_files: { done: "Listed files", pending: "Listing files", icon: Files },
  patch: { done: "Patched file", pending: "Patching file", icon: FileDiff },
  read_file: { done: "Read file", pending: "Reading file", icon: FileText },
  search_files: { done: "Searched files", pending: "Searching files", icon: Search },
  session_search_recall: { done: "Searched session history", pending: "Searching session history", icon: Search },
  terminal: { done: "Ran command", pending: "Running command", icon: Terminal },
  todo: { done: "Updated todos", pending: "Updating todos", icon: Wrench },
  vision_analyze: { done: "Analyzed image", pending: "Analyzing image", icon: Eye },
  web_extract: { done: "Read webpage", pending: "Reading webpage", icon: Globe },
  web_search: { done: "Searched web", pending: "Searching web", icon: Search },
  write_file: { done: "Edited file", pending: "Editing file", icon: SquarePen },
};

/** snake_case → Title Case, with the browser_/web_ namespace stripped. */
function titleForTool(name: string): string {
  const normalized = name.replace(/^browser_/, "").replace(/^web_/, "");
  return (
    normalized
      .split("_")
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
      .join(" ") || name
  );
}

const PREFIX_META: { prefix: string; verb: string; icon: LucideIcon }[] = [
  { prefix: "browser_", verb: "Browser", icon: Globe },
  { prefix: "web_", verb: "Web", icon: Globe },
];

// Primary-argument keys, most-specific first — the TS mirror of the server's
// `tool_preview` (server/runs.py) so history rebuilds show the same one-line
// preview the live tool.started frame carried.
const PREVIEW_KEYS = [
  "command", "code", "query", "search_term", "path", "file_path",
  "filename", "url", "urls", "text", "prompt", "name",
] as const;

/** One-line human preview of a tool call's arguments (raw JSON string or
 *  parsed object). Mirrors the server's extraction: primary key first, string
 *  lists joined with ", ", then any string value, then the raw dump. */
export function previewFromArgs(args: unknown, limit = 300): string {
  let parsed: unknown = args;
  if (typeof args === "string") {
    const raw = args.trim();
    if (!raw) return "";
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw.slice(0, limit);
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return typeof parsed === "string" ? parsed.slice(0, limit) : "";
  }
  const rec = parsed as Record<string, unknown>;
  for (const key of PREVIEW_KEYS) {
    const v = rec[key];
    if (typeof v === "string" && v) return v.slice(0, limit);
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) {
      return (v as string[]).join(", ").slice(0, limit);
    }
  }
  for (const v of Object.values(rec)) {
    if (typeof v === "string" && v) return v.slice(0, limit);
  }
  try {
    return JSON.stringify(rec).slice(0, limit);
  } catch {
    return "";
  }
}

export function toolMeta(name: string): ToolMeta {
  const known = TOOL_META[name];
  if (known) return known;

  const action = titleForTool(name);
  const prefix = PREFIX_META.find((p) => name.startsWith(p.prefix));
  return prefix
    ? {
        done: `${prefix.verb} ${action}`,
        pending: `Running ${prefix.verb.toLowerCase()} ${action.toLowerCase()}`,
        icon: prefix.icon,
      }
    : { done: action, pending: `Running ${action.toLowerCase()}`, icon: Wrench };
}
