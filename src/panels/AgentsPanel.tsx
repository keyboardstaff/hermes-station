import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/store/chat";
import {
  useSubagents, buildSubagentTree,
  type SubagentNode, type SubagentStatus, type SubagentStreamEntry,
} from "@/store/subagents";
import BrailleSpinner from "@/components/ui/BrailleSpinner";
import { useEnterAnimation } from "@/hooks/useEnterAnimation";
import { useElapsedSeconds, formatElapsed } from "@/hooks/useElapsedSeconds";

/**
 * AgentsPanel — subagent observability for the active session (desktop
 * parity). The agent's delegated subagents stream lifecycle/progress events
 * (relayed from delegate_tool through the parent's tool-progress callback,
 * broadcast on the run channel by runs.py); this renders them as a live tree.
 */

type ML = NonNullable<ReturnType<typeof useI18n>["t"]["agents"]>;

function StatusGlyph({ status }: { status: SubagentStatus }) {
  if (status === "running" || status === "queued") {
    return <BrailleSpinner className="hms-subagent-spinner" />;
  }
  if (status === "failed" || status === "interrupted") {
    return <AlertCircle size={14} className="hms-subagent-glyph" data-tone="error" />;
  }
  return <CheckCircle2 size={14} className="hms-subagent-glyph" data-tone="ok" />;
}

export default function AgentsPanel() {
  const { t } = useI18n();
  const a = t.agents;
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const bySession = useSubagents((s) => s.bySession);

  const items = useMemo(
    () => (activeSessionId ? bySession[activeSessionId] ?? [] : []),
    [activeSessionId, bySession],
  );
  const tree = useMemo(() => buildSubagentTree(items), [items]);

  const flat = useMemo(() => {
    const out: SubagentNode[] = [];
    const walk = (nodes: SubagentNode[]) => nodes.forEach((n) => { out.push(n); walk(n.children); });
    walk(tree);
    return out;
  }, [tree]);

  const active = flat.filter((n) => n.status === "running" || n.status === "queued").length;

  // Tick the relative "updated ago" labels while anything is live.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (active <= 0) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return (
    <div className="hms-subagents-root">
      <div className="hms-subagents-body">
        <header className="hms-subagents-head">
          <h2 className="hms-subagents-title">{a.title}</h2>
          <p className="hms-subagents-subtitle">{a.subtitle}</p>
        </header>

        {tree.length === 0 ? (
          <div className="hms-subagents-empty">
            <Sparkles size={24} className="hms-subagents-empty-icon" />
            <p className="hms-subagents-empty-title">{a.emptyTitle}</p>
            <p className="hms-subagents-empty-desc">{a.emptyDesc}</p>
          </div>
        ) : (
          <>
            <p className="hms-subagents-summary">{summaryLine(flat, a)}</p>
            <div className="hms-subagents-tree">
              {tree.map((node) => (
                <SubagentRow key={node.id} node={node} depth={0} nowMs={nowMs} a={a} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function summaryLine(flat: SubagentNode[], a: ML): string {
  const active = flat.filter((n) => n.status === "running" || n.status === "queued").length;
  const failed = flat.filter((n) => n.status === "failed" || n.status === "interrupted").length;
  const tools = flat.reduce((s, n) => s + (n.toolCount ?? 0), 0);
  const tokens = flat.reduce((s, n) => s + (n.inputTokens ?? 0) + (n.outputTokens ?? 0), 0);
  const cost = flat.reduce((s, n) => s + (n.costUsd ?? 0), 0);
  return [
    `${flat.length} ${a.agentsLabel}`,
    active > 0 ? `${active} ${a.activeLabel}` : "",
    failed > 0 ? `${failed} ${a.failedLabel}` : "",
    tools > 0 ? `${tools} ${a.toolsLabel}` : "",
    tokens > 0 ? fmtTokens(tokens) : "",
    cost > 0 ? `$${cost.toFixed(2)}` : "",
  ].filter(Boolean).join(" · ");
}

function fmtTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value);
}

function fmtAge(updatedAt: number, nowMs: number, a: ML): string {
  const s = Math.max(0, Math.round((nowMs - updatedAt) / 1000));
  if (s < 2) return a.ageNow;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

const STREAM_TONE: Record<SubagentStreamEntry["kind"], string> = {
  progress: "muted",
  summary: "ok",
  thinking: "muted",
  tool: "default",
};

function SubagentRow({
  node, depth, nowMs, a,
}: {
  node: SubagentNode;
  depth: number;
  nowMs: number;
  a: ML;
}) {
  const running = node.status === "running" || node.status === "queued";
  const elapsed = useElapsedSeconds(running, `subagent:${node.id}`);
  const enterRef = useEnterAnimation(true, `subagent-row:${node.id}`);
  const [open, setOpen] = useState(() => running || depth < 2);

  useEffect(() => { if (running) setOpen(true); }, [running]);

  const duration = typeof node.durationSeconds === "number"
    ? Math.max(0, Math.round(node.durationSeconds))
    : elapsed;
  const tokens = (node.inputTokens ?? 0) + (node.outputTokens ?? 0);
  const subtitle = [
    node.model,
    duration > 0 ? formatElapsed(duration) : "",
    node.toolCount ? `${node.toolCount} ${a.toolsLabel}` : "",
    tokens > 0 ? fmtTokens(tokens) : "",
    `${a.updatedPrefix} ${fmtAge(node.updatedAt, nowMs, a)}`,
  ].filter(Boolean).join(" · ");

  const visibleRows = open ? node.stream.slice(-10) : node.stream.slice(-2);
  const fileLines = [
    ...node.filesWritten.map((p) => `+ ${p}`),
    ...node.filesRead.map((p) => `· ${p}`),
  ];

  return (
    <div ref={enterRef} className="hms-subagent-row" data-depth={depth > 0 ? "nested" : undefined}>
      <button
        type="button"
        className="hms-subagent-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hms-subagent-status"><StatusGlyph status={node.status} /></span>
        <span className="hms-subagent-main">
          <span className="hms-subagent-goal" data-running={running || undefined}>{node.goal}</span>
          {subtitle && <span className="hms-subagent-subtitle">{subtitle}</span>}
        </span>
        {running && <span className="hms-subagent-timer">{formatElapsed(duration)}</span>}
      </button>

      {visibleRows.length > 0 && (
        <div className="hms-subagent-stream">
          {visibleRows.map((entry, i) => (
            <div
              key={`${entry.kind}:${entry.at}:${i}`}
              className="hms-subagent-stream-line"
              data-tone={entry.isError ? "error" : STREAM_TONE[entry.kind]}
              data-mono={entry.kind === "tool" || undefined}
            >
              <span className="hms-subagent-stream-glyph" aria-hidden>
                {entry.isError ? "!" : entry.kind === "summary" ? "✓" : entry.kind === "thinking" ? "…" : "·"}
              </span>
              <span className="hms-subagent-stream-text">{entry.text}</span>
            </div>
          ))}
        </div>
      )}

      {open && fileLines.length > 0 && (
        <div className="hms-subagent-files">
          <p className="hms-subagent-files-label">{a.files}</p>
          {fileLines.slice(0, 8).map((line) => (
            <p key={line} className="hms-subagent-file">{line}</p>
          ))}
          {fileLines.length > 8 && (
            <p className="hms-subagent-file" data-muted>{`+${fileLines.length - 8}`}</p>
          )}
        </div>
      )}

      {node.children.length > 0 && (
        <div className="hms-subagent-children">
          {node.children.map((child) => (
            <SubagentRow key={child.id} node={child} depth={depth + 1} nowMs={nowMs} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}
