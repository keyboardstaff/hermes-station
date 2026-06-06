/**
 * Artifacts projection — collect images / files / links from sessions' messages,
 * a read-only projection over existing transcripts (no new storage). Ported from
 * upstream desktop's `collectArtifactsForSession` so the extraction logic stays
 * 1:1 with it: scan only assistant + tool messages, pull markdown images / links,
 * bare URLs and file paths from the text, and recurse tool-call args / tool-result
 * JSON for path/url-shaped values under artifact-ish keys.
 *
 * Pure + deterministic — unit-tested without the DOM or network.
 */

export type ArtifactKind = "image" | "file" | "link";

/**
 * The higher-level category an artifact belongs to, so changes (file edits) and
 * git activity are visually distinct from passive references (image/file/link
 * URLs & paths) and don't get confused:
 *   • `edit` — a file the agent wrote/edited (a file-modification tool call)
 *   • `git`  — a git operation (commit / diff / status …)
 *   • `ref`  — an image / file / link referenced in text or tool output
 */
export type ArtifactGroup = "edit" | "git" | "ref";

export interface ArtifactRecord {
  /** Dedup + React key — `${sessionId}:${value}`. */
  id: string;
  group: ArtifactGroup;
  kind: ArtifactKind;
  /** For `edit` / `git`: the tool / op name (e.g. `write_file`, `git`). */
  tool?: string;
  /** Raw extracted value (path / url / git command). */
  value: string;
  /** Openable href (`file://` for absolute paths, else the value). */
  href: string;
  /** Display label — filename / last url segment. */
  label: string;
  sessionId: string;
  sessionTitle: string;
  /** The session's recorded working dir — resolves relative file paths. */
  sessionCwd?: string;
  /** Epoch ms (for sort + display). */
  timestamp: number;
  /** Numeric DB row id of the first message it came from — feeds the chat
   *  scroll-to (`pendingScrollMessageId`). Null when unknown. */
  messageRowId: number | null;
}

/** Minimal message shape (a superset of `MessageRow` + upstream `SessionMessage`). */
export interface ArtifactMessage {
  id?: number;
  role: string;
  content?: unknown;
  text?: unknown;
  context?: unknown;
  tool_calls?: unknown;
  timestamp?: number;
}

export interface ArtifactSession {
  id: string;
  title: string;
  cwd?: string;
  updated_at?: number;
  started_at?: number;
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/g;
const PATH_RE = /(^|[\s("'`])((?:\/|~\/|\.\.?\/)[^\s"'`<>]+(?:\.[a-z0-9]{1,8})?)/gi;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp)(?:\?.*)?$/i;
const FILE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|pdf|txt|json|md|csv|zip|tar|gz|mp3|wav|mp4|mov)(?:\?.*)?$/i;
const KEY_HINT_RE = /(path|file|url|image|artifact|output|download|result|target)/i;

// File-modification tool names (case-insensitive partial match) → `edit` group.
const FILE_OP_RE = /write_file|edit_file|create_file|str_replace|apply_patch|patch_file|delete_file|move_file|rename_file|save_file|multi_edit|new_file/i;
// A git invocation inside a shell command → `git` group.
const GIT_CMD_RE = /(?:^|\s|&&|;|\|)git\s+[a-z]/i;
// Argument keys that carry a written path / a shell command.
const EDIT_KEYS = ["path", "file_path", "filepath", "filename", "file", "target_file", "target", "abs_path"];
const CMD_KEYS = ["command", "cmd", "script", "input", "code", "shell"];

function callName(call: unknown): string | undefined {
  if (!call || typeof call !== "object") return undefined;
  const c = call as Record<string, unknown>;
  const fn = c.function as Record<string, unknown> | undefined;
  const n = (fn?.name ?? c.name) as unknown;
  return typeof n === "string" ? n : undefined;
}

function callArgs(call: unknown): Record<string, unknown> {
  if (!call || typeof call !== "object") return {};
  const c = call as Record<string, unknown>;
  const fn = c.function as Record<string, unknown> | undefined;
  const raw = fn?.arguments ?? c.arguments ?? c.input ?? c.parameters;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** First git command in a (possibly chained) shell command, trimmed for display. */
function gitSummary(command: string): string {
  const m = command.match(/git\s+[^\n&;|]+/i);
  return (m ? m[0] : command).trim().slice(0, 120);
}

function normalizeValue(value: string): string {
  return value.trim().replace(/[),.;]+$/, "");
}

function parseMaybeJson(value: string): unknown {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function looksLikePathOrUrl(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("file://") ||
    value.startsWith("data:image/") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/")
  );
}

export function looksLikeArtifact(value: string): boolean {
  if (/^(?:https?:\/\/|data:image\/)/.test(value)) return true;
  if (looksLikePathOrUrl(value) && (IMAGE_EXT_RE.test(value) || FILE_EXT_RE.test(value))) return true;
  return value.startsWith("/") && value.includes(".");
}

export function artifactKind(value: string): ArtifactKind {
  if (value.startsWith("data:image/") || IMAGE_EXT_RE.test(value)) return "image";
  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/") ||
    value.startsWith("file://")
  ) {
    return "file";
  }
  return "link";
}

function artifactHref(value: string): string {
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("file://") ||
    value.startsWith("data:")
  ) {
    return value;
  }
  if (value.startsWith("/")) return `file://${encodeURI(value)}`;
  return value;
}

export function artifactLabel(value: string): string {
  try {
    const url = new URL(value);
    const item = url.pathname.split("/").filter(Boolean).pop();
    return item || value;
  } catch {
    const parts = value.split(/[\\/]/).filter(Boolean);
    return parts.pop() || value;
  }
}

function messageText(message: ArtifactMessage): string {
  if (typeof message.content === "string" && message.content.trim()) return message.content;
  if (typeof message.text === "string" && message.text.trim()) return message.text;
  if (typeof message.context === "string" && message.context.trim()) return message.context;
  return "";
}

function collectStringValues(
  value: unknown,
  keyPath: string,
  collector: (value: string, keyPath: string) => void,
): void {
  if (typeof value === "string") {
    collector(value, keyPath);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStringValues(entry, `${keyPath}.${index}`, collector));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectStringValues(child, keyPath ? `${keyPath}.${key}` : key, collector);
  }
}

function collectArtifactsFromText(text: string, pushValue: (value: string) => void): void {
  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    pushValue(match[2] || "");
  }
  for (const match of text.matchAll(MARKDOWN_LINK_RE)) {
    const start = match.index ?? 0;
    if (start > 0 && text[start - 1] === "!") continue; // that's a markdown image
    const value = match[2] || "";
    if (looksLikeArtifact(value)) pushValue(value);
  }
  for (const match of text.matchAll(URL_RE)) {
    const value = match[0] || "";
    if (looksLikeArtifact(value)) pushValue(value);
  }
  for (const match of text.matchAll(PATH_RE)) {
    pushValue(match[2] || "");
  }
}

type Emit = (group: ArtifactGroup, value: string, tool?: string) => void;

/** Pass 1: file-modification + git tool calls (the `edit` / `git` groups). */
function collectChangesFromMessage(message: ArtifactMessage, emit: Emit): void {
  if (!Array.isArray(message.tool_calls)) return;
  for (const call of message.tool_calls) {
    const name = callName(call) ?? "";
    const args = callArgs(call);

    if (FILE_OP_RE.test(name)) {
      const path = pickStr(args, EDIT_KEYS);
      if (path) emit("edit", path, name);
      continue;
    }
    const cmd = pickStr(args, CMD_KEYS);
    if (cmd && GIT_CMD_RE.test(cmd)) {
      emit("git", gitSummary(cmd), "git");
    } else if (/(?:^|[_-])git(?:[_-]|$)/i.test(name)) {
      emit("git", name, "git");
    }
  }
}

/** Pass 2: passive references (image/file/link) from text + tool output. */
function collectRefsFromMessage(message: ArtifactMessage, emit: Emit): void {
  const push = (value: string) => emit("ref", value);
  const text = messageText(message);
  if (text) collectArtifactsFromText(text, push);

  if (message.role !== "tool" && !Array.isArray(message.tool_calls)) return;

  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      collectStringValues(call, "tool_call", (value, keyPath) => {
        const normalized = normalizeValue(value);
        if (!normalized) return;
        if (KEY_HINT_RE.test(keyPath) && (looksLikePathOrUrl(normalized) || FILE_EXT_RE.test(normalized))) {
          push(normalized);
        }
      });
    }
  }

  const parsed = parseMaybeJson(text);
  if (parsed !== null) {
    collectStringValues(parsed, "tool_result", (value, keyPath) => {
      const normalized = normalizeValue(value);
      if (!normalized) return;
      if ((KEY_HINT_RE.test(keyPath) || looksLikePathOrUrl(normalized)) && looksLikeArtifact(normalized)) {
        push(normalized);
      }
    });
  }
}

export function collectArtifactsForSession(
  session: ArtifactSession,
  messages: ArtifactMessage[],
): ArtifactRecord[] {
  const found = new Map<string, ArtifactRecord>();
  const fallbackSec = session.updated_at || session.started_at || Math.floor(Date.now() / 1000);

  const emitFor = (message: ArtifactMessage): Emit => (group, rawValue, tool) => {
    const value = normalizeValue(rawValue);
    if (!value) return;
    // `ref` keeps the artifact-shape gate; `edit`/`git` are trusted tool signals.
    if (group === "ref" && !looksLikeArtifact(value)) return;

    const key = `${session.id}:${value}`;
    if (found.has(key)) return; // first wins — pass 1 (changes) beats pass 2 (refs)

    const tsSec = message.timestamp || fallbackSec;
    found.set(key, {
      id: key,
      group,
      kind: group === "ref" ? artifactKind(value) : "file",
      tool,
      value,
      href: group === "git" ? "" : artifactHref(value),
      label: group === "git" ? value : artifactLabel(value),
      sessionId: session.id,
      sessionTitle: session.title,
      sessionCwd: session.cwd,
      timestamp: tsSec * 1000,
      messageRowId: typeof message.id === "number" ? message.id : null,
    });
  };

  // Two passes over the same dedup map so a written/edited file shows once, as a
  // change — never also as a passive "file" reference.
  for (const message of messages) {
    if (message.role !== "assistant" && message.role !== "tool") continue;
    collectChangesFromMessage(message, emitFor(message));
  }
  for (const message of messages) {
    if (message.role !== "assistant" && message.role !== "tool") continue;
    collectRefsFromMessage(message, emitFor(message));
  }

  return Array.from(found.values());
}
