import { create } from "zustand";

/**
 * Subagent observability — port of upstream desktop's `store/subagents`:
 * per-session progress records fed by `subagent.*` run events (relayed from
 * delegate_tool through the parent agent's tool_progress_callback), rendered
 * as a tree on /agents. Live-view only: state is in-memory per tab.
 */

export type SubagentStatus = "completed" | "failed" | "interrupted" | "queued" | "running";
export type SubagentStreamKind = "progress" | "summary" | "thinking" | "tool";

export interface SubagentStreamEntry {
  at: number;
  isError?: boolean;
  kind: SubagentStreamKind;
  text: string;
}

export interface SubagentProgress {
  id: string;
  parentId: string | null;
  goal: string;
  model?: string;
  status: SubagentStatus;
  taskCount: number;
  taskIndex: number;
  startedAt: number;
  updatedAt: number;
  durationSeconds?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  toolCount?: number;
  filesRead: string[];
  filesWritten: string[];
  stream: SubagentStreamEntry[];
  summary?: string;
  /** Active tool while running — cleared on terminal status. */
  currentTool?: string;
}

export interface SubagentNode extends SubagentProgress {
  children: SubagentNode[];
}

export type SubagentPayload = Record<string, unknown>;

const TERMINAL: ReadonlySet<SubagentStatus> = new Set(["completed", "failed", "interrupted"]);
const MAX_STREAM = 24;
const PREVIEW_MAX = 220;
const TOOL_PREVIEW_MAX = 96;

const isStr = (v: unknown): v is string => typeof v === "string";
const str = (v: unknown) => (isStr(v) ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const strList = (v: unknown) => (Array.isArray(v) ? v.filter(isStr) : []);

const asStatus = (v: unknown): SubagentStatus =>
  v === "completed" || v === "failed" || v === "interrupted" || v === "queued" ? v : "running";

const compact = (text: string, max = PREVIEW_MAX) => {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const toolLabel = (name: string) =>
  name
    .split("_")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ") || name;

const formatTool = (name: string, preview = "") => {
  const snippet = compact(preview, TOOL_PREVIEW_MAX);
  return snippet ? `${toolLabel(name)}("${snippet}")` : toolLabel(name);
};

interface TailEntry {
  isError?: boolean;
  preview?: string;
  tool?: string;
}

const asTail = (v: unknown): TailEntry[] =>
  Array.isArray(v)
    ? v
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => ({
          isError: item.is_error === true,
          preview: str(item.preview) || undefined,
          tool: str(item.tool) || undefined,
        }))
    : [];

const idOf = (p: SubagentPayload) =>
  str(p.subagent_id) || `${str(p.parent_id) || "root"}:${num(p.task_index) ?? 0}:${str(p.goal)}`;

const appendStream = (stream: SubagentStreamEntry[], entry: SubagentStreamEntry) => {
  const last = stream[stream.length - 1];
  if (last?.kind === entry.kind && last.text === entry.text && last.isError === entry.isError) {
    return stream;
  }
  return [...stream, entry].slice(-MAX_STREAM);
};

function streamFromPayload(
  payload: SubagentPayload,
  status: SubagentStatus,
  eventType: string,
  at: number,
): SubagentStreamEntry[] {
  const out: SubagentStreamEntry[] = [];
  const tool = str(payload.tool_name);
  const preview = str(payload.tool_preview) || str(payload.text);
  const text = compact(str(payload.text) || preview);

  for (const tail of asTail(payload.output_tail)) {
    const line = tail.tool ? formatTool(tail.tool, tail.preview ?? "") : compact(tail.preview ?? "");
    if (line) {
      out.push({ at, isError: tail.isError, kind: tail.tool ? "tool" : "progress", text: line });
    }
  }

  if (tool) {
    out.push({ at, isError: !!payload.error, kind: "tool", text: formatTool(tool, preview) });
  }
  if (eventType === "subagent.progress" && text) {
    out.push({ at, isError: !!payload.error, kind: "progress", text });
  }
  if (eventType === "subagent.thinking" && text) {
    out.push({ at, kind: "thinking", text });
  }

  const summary = compact(str(payload.summary) || str(payload.text));
  if (TERMINAL.has(status) && summary) {
    out.push({ at, isError: status === "failed", kind: "summary", text: summary });
  }

  return out;
}

function toProgress(
  payload: SubagentPayload,
  prev: SubagentProgress | undefined,
  eventType = "",
): SubagentProgress {
  const at = Date.now();
  const status = asStatus(payload.status);
  const tool = str(payload.tool_name);
  const stream = streamFromPayload(payload, status, eventType, at).reduce(appendStream, prev?.stream ?? []);
  const filesRead = strList(payload.files_read);
  const filesWritten = strList(payload.files_written);

  return {
    id: prev?.id ?? idOf(payload),
    parentId: str(payload.parent_id) || prev?.parentId || null,
    goal: str(payload.goal) || prev?.goal || "Subagent",
    model: str(payload.model) || prev?.model,
    status,
    taskCount: num(payload.task_count) ?? prev?.taskCount ?? 1,
    taskIndex: num(payload.task_index) ?? prev?.taskIndex ?? 0,
    startedAt: prev?.startedAt ?? at,
    updatedAt: at,
    durationSeconds: num(payload.duration_seconds) ?? prev?.durationSeconds,
    costUsd: num(payload.cost_usd) ?? prev?.costUsd,
    inputTokens: num(payload.input_tokens) ?? prev?.inputTokens,
    outputTokens: num(payload.output_tokens) ?? prev?.outputTokens,
    toolCount: num(payload.tool_count) ?? prev?.toolCount,
    filesRead: filesRead.length ? filesRead : (prev?.filesRead ?? []),
    filesWritten: filesWritten.length ? filesWritten : (prev?.filesWritten ?? []),
    stream,
    summary: str(payload.summary) || prev?.summary,
    currentTool: TERMINAL.has(status) ? undefined : tool || prev?.currentTool,
  };
}

interface SubagentsState {
  bySession: Record<string, SubagentProgress[]>;
  upsert: (sid: string, payload: SubagentPayload, createIfMissing: boolean, eventType: string) => void;
  clearSession: (sid: string) => void;
}

export const useSubagents = create<SubagentsState>()((set, get) => ({
  bySession: {},

  upsert: (sid, payload, createIfMissing, eventType) => {
    if (!sid) return;
    const map = get().bySession;
    const list = map[sid] ?? [];
    const id = idOf(payload);
    const idx = list.findIndex((item) => item.id === id);
    if (idx < 0 && !createIfMissing) return;
    const prev = idx >= 0 ? list[idx] : undefined;
    if (prev && TERMINAL.has(prev.status)) return;
    const next = toProgress(payload, prev, eventType);
    const nextList = idx >= 0 ? list.map((item) => (item.id === id ? next : item)) : [...list, next];
    set({ bySession: { ...map, [sid]: nextList } });
  },

  clearSession: (sid) => {
    const map = get().bySession;
    if (!(sid in map)) return;
    const next = { ...map };
    delete next[sid];
    set({ bySession: next });
  },
}));

/** subagent.* event types accepted off the wire. */
export const SUBAGENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  "subagent.spawn_requested",
  "subagent.start",
  "subagent.thinking",
  "subagent.tool",
  "subagent.progress",
  "subagent.complete",
]);

/** Events that may CREATE a record; the rest only update existing ones. */
export const SUBAGENT_CREATE_EVENTS: ReadonlySet<string> = new Set([
  "subagent.spawn_requested",
  "subagent.start",
]);

export function buildSubagentTree(items: readonly SubagentProgress[]): SubagentNode[] {
  const nodes = new Map<string, SubagentNode>();
  for (const item of items) nodes.set(item.id, { ...item, children: [] });

  const roots: SubagentNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (a: SubagentNode, b: SubagentNode) =>
    a.startedAt - b.startedAt || a.taskIndex - b.taskIndex || a.goal.localeCompare(b.goal);
  const walk = (node: SubagentNode) => node.children.sort(sortNodes).forEach(walk);
  roots.sort(sortNodes).forEach(walk);

  return roots;
}

export const activeSubagentCount = (items: readonly SubagentProgress[]) =>
  items.filter((item) => item.status === "queued" || item.status === "running").length;
