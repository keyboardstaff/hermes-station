import { useEffect, useState } from "react";
import {
  ChevronDown, ChevronRight, XCircle, Copy, Check,
  AlertTriangle, Clock, MinusCircle,
} from "lucide-react";
import type { ToolCall } from "@/lib/hermes-types";
import { toolMeta } from "@/lib/tool-meta";
import { useEnterAnimation } from "@/hooks/useEnterAnimation";
import { useToolViewStore } from "@/store/app";

// Braille spinner frames — mirrors desktop's BrailleSpinner (which mirrors the
// Ink TUI) so the running state reads the same across surfaces.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function BrailleSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span role="status" aria-label="Running" className="hms-tool-spinner">
      {SPINNER_FRAMES[frame]}
    </span>
  );
}

/** Leading glyph, desktop-style: running → spinner; failure states announce
 *  themselves; success is silent — the tool's own icon in a quiet tone. */
function StatusGlyph({ tc }: { tc: ToolCall }) {
  switch (tc.status) {
    case "running":
      return (
        <span className="hms-tool-glyph">
          <BrailleSpinner />
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
    default: {
      const Icon = toolMeta(tc.toolName).icon;
      return (
        <span className="hms-tool-glyph">
          <Icon size={13} />
        </span>
      );
    }
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

/** Unwrap the Hermes standard `{result, error}` envelope for readable output. */
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
 * One tool action, mirroring upstream desktop's tool rows. Collapsed: a flat
 * disclosure row — friendly verb title ("Ran command", shimmering "Running
 * command" while pending), the tool's icon (success is silent — no green
 * check), inline args preview, a caret revealed on hover, a live timer /
 * duration on the right; rows mounting mid-stream play desktop's 180ms enter
 * animation. Expanded, the detail sits on a soft inset surface (Station
 * aesthetic — no hard border), with copy on the section label.
 *
 * Tool Call Display (Settings → Appearance), same split as upstream:
 *   - Product: expands to the readable output (envelope-unwrapped result).
 *   - Technical: expands to the raw input/output trace under the raw tool name.
 */
export default function ToolCallCard({ tc }: { tc: ToolCall }) {
  const technical = useToolViewStore((s) => s.toolView === "technical");
  const [expanded, setExpanded] = useState(false);
  const running = tc.status === "running";
  // Animate only rows that mount while running — history paints statically.
  const enterRef = useEnterAnimation(running, `tool-enter:${tc.id}`);
  const meta = toolMeta(tc.toolName);
  const title = running ? meta.pending : meta.done;

  const canExpand = technical ? Boolean(tc.preview || tc.result) : Boolean(tc.result);
  const open = canExpand && expanded;

  // Technical: one raw trace block (args + result), like desktop's technical
  // view; Product: just the readable output.
  const rawTrace = [tc.preview, tc.result].filter(Boolean).join("\n");

  return (
    <div className="hms-tool" data-open={open ? "true" : undefined} ref={enterRef}>
      <div className="hms-tool-header">
        <button
          type="button"
          className="hms-tool-row"
          onClick={canExpand ? () => setExpanded((e) => !e) : undefined}
          disabled={!canExpand}
          aria-expanded={canExpand ? open : undefined}
        >
          <StatusGlyph tc={tc} />
          <span
            className={`hms-tool-title${running ? " hms-tool-shimmer" : ""}`}
            data-status={tc.status}
          >
            {title}
          </span>
          {tc.preview && !open && (
            <span className={`hms-tool-preview${running ? " hms-tool-shimmer" : ""}`}>
              {tc.preview}
            </span>
          )}
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
            tc.duration !== undefined && (
              <span className="hms-tool-meta">{tc.duration.toFixed(1)}s</span>
            )
          )}
        </span>
      </div>

      {canExpand && (
        <div className="hms-tool-detail" data-open={open ? "true" : undefined}>
          <div className="hms-tool-detail-clip">
            <div className="hms-tool-body">
              {technical ? (
                <div>
                  <div className="hms-tool-section-label">
                    <span>{tc.toolName}</span>
                    <CopyButton text={rawTrace} />
                  </div>
                  <pre className="hms-tool-pre">{rawTrace}</pre>
                </div>
              ) : (
                tc.result && (
                  <div>
                    <div className="hms-tool-section-label">
                      <span>Output</span>
                      <CopyButton text={tc.result} />
                    </div>
                    <pre className="hms-tool-pre">{unwrapResult(tc.result)}</pre>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
