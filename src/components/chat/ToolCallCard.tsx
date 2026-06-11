import { useEffect, useState } from "react";
import {
  ChevronDown, ChevronRight, Loader2, XCircle, Copy, Check,
  AlertTriangle, Clock, MinusCircle, Wrench,
} from "lucide-react";
import type { ToolCall } from "@/lib/hermes-types";
import { useToolViewStore } from "@/store/app";

/** Leading glyph, desktop-style: success is silent (a quiet tool glyph instead
 *  of a green check) — only running / failure states announce themselves. */
function StatusGlyph({ status }: { status: ToolCall["status"] }) {
  switch (status) {
    case "running":
      return (
        <span className="hms-tool-glyph">
          <Loader2 size={13} className="hms-tool-spin" />
        </span>
      );
    case "error":
      return (
        <span className="hms-tool-glyph" data-tone="error">
          <XCircle size={13} />
        </span>
      );
    case "approval_required":
      return (
        <span className="hms-tool-glyph" data-tone="warning">
          <AlertTriangle size={13} />
        </span>
      );
    case "timeout":
      return (
        <span className="hms-tool-glyph" data-tone="warning">
          <Clock size={13} />
        </span>
      );
    case "cancelled":
      return (
        <span className="hms-tool-glyph">
          <MinusCircle size={13} />
        </span>
      );
    default:
      return (
        <span className="hms-tool-glyph">
          <Wrench size={13} />
        </span>
      );
  }
}

/** Live elapsed seconds while the tool runs (desktop's activity timer). */
function Elapsed() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="hms-tool-meta">{Math.max(0, Math.round((now - start) / 1000))}s</span>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="hms-tool-copy"
      title="Copy"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

/** Unwrap the Hermes standard `{result, error}` envelope for display. */
function unwrapResult(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && "result" in parsed) {
      const inner = parsed.result;
      return typeof inner === "string" ? inner : JSON.stringify(inner, null, 2);
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

/**
 * One tool action, styled after upstream desktop's tool rows: collapsed it is
 * a flat disclosure row (no card chrome — glyph, name, inline preview, a caret
 * revealed on hover, live timer / copy on the right); expanded it becomes a
 * bordered block with labeled INPUT / OUTPUT sections. Product mode hides raw
 * payloads entirely (no expansion), mirroring desktop's Tool Call Display.
 */
export default function ToolCallCard({ tc }: { tc: ToolCall }) {
  const technical = useToolViewStore((s) => s.toolView === "technical");
  const [expanded, setExpanded] = useState(false);
  const running = tc.status === "running";
  const canExpand = technical && Boolean(tc.preview || tc.result);
  const open = canExpand && expanded;
  const copyText = tc.result ?? tc.preview ?? "";

  return (
    <div className="hms-tool" data-open={open ? "true" : undefined}>
      <div className="hms-tool-header">
        <button
          type="button"
          className="hms-tool-row"
          onClick={canExpand ? () => setExpanded((e) => !e) : undefined}
          disabled={!canExpand}
          aria-expanded={canExpand ? open : undefined}
        >
          <StatusGlyph status={tc.status} />
          <span className="hms-tool-title" data-status={tc.status}>{tc.toolName}</span>
          {tc.preview && !open && <span className="hms-tool-preview">{tc.preview}</span>}
          {canExpand && (
            <span className="hms-tool-caret">
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          )}
        </button>
        <span className="hms-tool-trailing">
          {running ? (
            <Elapsed />
          ) : (
            <>
              {tc.duration !== undefined && (
                <span className="hms-tool-meta">{tc.duration.toFixed(1)}s</span>
              )}
              {copyText && <CopyButton text={copyText} />}
            </>
          )}
        </span>
      </div>

      {open && (
        <div className="hms-tool-body">
          {tc.preview && (
            <div>
              <div className="hms-tool-section-label">
                <span>Input</span>
                <CopyButton text={tc.preview} />
              </div>
              <pre className="hms-tool-pre">{tc.preview}</pre>
            </div>
          )}
          {tc.result && (
            <div>
              <div className="hms-tool-section-label">
                <span>Output</span>
                <CopyButton text={tc.result} />
              </div>
              <pre className="hms-tool-pre">{unwrapResult(tc.result)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
