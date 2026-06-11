import { useEffect, useRef, useState } from "react";

// Context ring + token helpers, extracted from Composer.

export interface UsageBreakdown {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

// ~4 chars per token (GPT approximation).
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(n);
}

/**
 * Context ring — session tokens used vs the model's context window. Click to
 * open a detail popover (input / output / total, limit, percentage) with a
 * token-display toggle (the ``/usage`` equivalent). `used` is the cumulative
 * session total from the last run; falls back to the live input estimate.
 */
export function ContextMeter({
  used, contextLength, usage, showTokens, onToggleTokens,
}: {
  used: number;
  contextLength: number | null;
  usage: UsageBreakdown | null;
  showTokens: boolean;
  onToggleTokens: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  // Fixed-position anchor: the popover must escape the composer toolbar's
  // overflow:hidden, so it positions against the viewport, not the parent.
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const pct = contextLength ? Math.min(1, used / contextLength) : 0;
  const pctLabel = contextLength ? `${Math.round((used / contextLength) * 100)}%` : "—";
  const r = 7;
  const c = 2 * Math.PI * r;
  const over = contextLength ? used / contextLength >= 0.9 : false;
  const stroke = over ? "var(--hms-error)" : "var(--hms-accent)";

  return (
    <div ref={ref} style={{ position: "relative", marginRight: 4 }}>
      <button
        type="button"
        ref={btnRef}
        onClick={() => {
          const rect = btnRef.current?.getBoundingClientRect();
          if (rect) {
            setAnchor({
              right: Math.max(8, window.innerWidth - rect.right),
              bottom: window.innerHeight - rect.top + 8,
            });
          }
          setOpen((o) => !o);
        }}
        title={contextLength ? `${used.toLocaleString()} / ${contextLength.toLocaleString()} tokens` : `${used.toLocaleString()} tokens`}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "transparent", cursor: "pointer", color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-xs)', padding: 0 }}
      >
        <svg width={18} height={18} viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
          <circle cx="9" cy="9" r={r} fill="none" stroke="var(--hms-border)" strokeWidth="2" />
          {contextLength && (
            <circle cx="9" cy="9" r={r} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 9 9)" />
          )}
        </svg>
        {showTokens && (
          <span style={{ whiteSpace: "nowrap" }}>
            {formatTokens(used)}{contextLength ? ` / ${formatTokens(contextLength)}` : "t"}
          </span>
        )}
      </button>

      {open && (
        <div
          className="hms-popup-panel"
          style={{
            position: "fixed",
            bottom: anchor?.bottom ?? 80,
            right: anchor?.right ?? 16,
            width: 220,
            background: "var(--hms-surface)", border: "1px solid var(--hms-border)",
            borderRadius: 10, boxShadow: "var(--hms-shadow-popover)", zIndex: 9999, padding: "10px 12px",
            display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)', fontSize: 'var(--hms-text-caption)',
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600 }}>
            <span>Context</span><span>{pctLabel}</span>
          </div>
          <MeterRow label="Limit" value={contextLength ? contextLength.toLocaleString() : "—"} />
          {usage ? (
            <>
              <MeterRow label="Input" value={usage.input_tokens.toLocaleString()} />
              <MeterRow label="Output" value={usage.output_tokens.toLocaleString()} />
              <MeterRow label="Total" value={used.toLocaleString()} strong />
            </>
          ) : (
            // No completed turn yet — the only number we have is the draft's
            // rough token estimate; label it as such instead of a bogus Total.
            <MeterRow label="Draft (est.)" value={used.toLocaleString()} strong />
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', cursor: "pointer", marginTop: 2, color: "var(--hms-text-muted)" }}>
            <input type="checkbox" checked={showTokens} onChange={(e) => onToggleTokens(e.target.checked)} />
            Show token count
          </label>
        </div>
      )}
    </div>
  );
}

function MeterRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", color: strong ? "var(--hms-text)" : "var(--hms-text-muted)", fontWeight: strong ? 600 : 400 }}>
      <span>{label}</span><span style={{ fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}
