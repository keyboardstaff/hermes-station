import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Copy, Check, AlertTriangle, Clock, MinusCircle } from "lucide-react";
import type { ToolCall } from "@/lib/hermes-types";

const STATUS_ICON: Record<ToolCall["status"], React.ReactNode> = {
  running: <Loader2 size={13} style={{ animation: "spin 1s linear infinite", color: "var(--hms-info, #60a5fa)", flexShrink: 0 }} />,
  done: <CheckCircle2 size={13} style={{ color: "var(--hms-success)", flexShrink: 0 }} />,
  error: <XCircle size={13} style={{ color: "var(--hms-error)", flexShrink: 0 }} />,
  approval_required: <AlertTriangle size={13} style={{ color: "var(--hms-warning)", flexShrink: 0 }} />,
  cancelled: <MinusCircle size={13} style={{ color: "var(--hms-text-muted)", flexShrink: 0 }} />,
  timeout: <Clock size={13} style={{ color: "var(--hms-warning)", flexShrink: 0 }} />,
};


function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{ border: "none", background: "none", cursor: "pointer", padding: "1px 3px", color: "var(--hms-text-muted)", display: "flex", alignItems: "center" }}
      title="Copy"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

export default function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      style={{
        margin: "4px 0",
        borderRadius: 10,
        // border: "1px solid var(--hms-border)",
        background: "color-mix(in srgb, var(--hms-surface) 80%, transparent)",
        fontSize: 'var(--hms-text-caption)',
        overflow: "hidden",
      }}
    >
      {/* Header row */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 'var(--hms-space-2)',
          padding: "6px 10px",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {STATUS_ICON[tc.status]}
        {/* Tool name */}
        <span style={{ fontFamily: "monospace", color: "var(--hms-text)", fontWeight: 600, flexShrink: 0 }}>
          {tc.toolName}
        </span>
        {/* Preview inline (collapsed view) */}
        {tc.preview && !expanded && (
          <span style={{
            flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-xs)',
          }}>
            {tc.preview}
          </span>
        )}
        {/* Right side: status badge + duration + chevron */}
        <span style={{
          marginLeft: "auto", flexShrink: 0,
          fontSize: '0.625rem', color: "var(--hms-text-muted)",
          display: "flex", alignItems: "center", gap: 'var(--hms-space-1)',
        }}>
          {tc.duration !== undefined && (
            <span style={{ color: "var(--hms-text-muted)" }}>
              {tc.duration.toFixed(2)}s
            </span>
          )}
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </div>

      {/* Expandable detail — grid-row transition gives smooth height animation
          without needing a fixed max-height guess. */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
          transition: "grid-template-rows 0.2s ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          {/* Expanded detail: show preview (the command/query) */}
          {tc.preview && (
            <div style={{ borderTop: "1px solid var(--hms-border)", padding: "8px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-1)', fontSize: '0.625rem', color: "var(--hms-text-muted)", marginBottom: 4 }}>
                <span>ARGS</span>
                <CopyButton text={tc.preview} />
              </div>
              <pre style={{ margin: 0, fontSize: 'var(--hms-text-xs)', whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--hms-text)", maxHeight: 200, overflowY: "auto" }}>
                {tc.preview}
              </pre>
            </div>
          )}

          {/* Expanded detail: tool execution result */}
          {tc.result && (
            <div style={{ borderTop: "1px solid var(--hms-border)", padding: "8px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-1)', fontSize: '0.625rem', color: "var(--hms-text-muted)", marginBottom: 4 }}>
                <span>RESULT</span>
                <CopyButton text={tc.result} />
              </div>
              <pre style={{ margin: 0, fontSize: 'var(--hms-text-xs)', whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--hms-text)", maxHeight: 300, overflowY: "auto" }}>
                {(() => {
                  try {
                    const parsed = JSON.parse(tc.result);
                    // Unwrap Hermes standard {result, error} envelope
                    if (parsed !== null && typeof parsed === "object" && "result" in parsed) {
                      const inner = parsed.result;
                      return typeof inner === "string" ? inner : JSON.stringify(inner, null, 2);
                    }
                    return JSON.stringify(parsed, null, 2);
                  } catch {
                    return tc.result;
                  }
                })()}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
