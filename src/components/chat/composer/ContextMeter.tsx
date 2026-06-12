import { useRef, useState } from "react";

// Context ring + token helpers, extracted from Composer.

export interface UsageBreakdown {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  /** Prompt-cache counters (when the provider reports them). */
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  /** The agent compressor's authoritative window — covers local/custom models
   *  models.dev can't resolve. */
  context_length?: number;
  /** Auto-compression threshold (tokens + percent of the window). */
  auto_compress_at?: number;
  auto_compress_percent?: number;
  /** Current WINDOW occupancy (the last LLM call's prompt+completion) — the
   *  ring's numerator. The session totals above accumulate across calls and
   *  would over-count the ring by orders of magnitude. */
  context_used_tokens?: number;
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
 * Context ring — current window occupancy vs the model's context window, the
 * used-percent inside the ring (desktop-style). Hover (or click, for touch)
 * reveals the detail: used/left, window totals, auto-compress threshold,
 * prompt-cache hit rate and the session token totals. `usage.context_*`
 * (agent-compressor sourced) is authoritative; the models.dev lookup is the
 * fallback window, and the draft estimate seeds the ring before turn one.
 */
export function ContextMeter({
  draftTokens, contextLength, usage,
}: {
  /** Rough token estimate of the unsent draft (pre-first-turn fallback). */
  draftTokens: number;
  contextLength: number | null;
  usage: UsageBreakdown | null;
}) {
  const [open, setOpen] = useState(false);
  // Fixed-position anchor: the popover must escape the composer toolbar's
  // overflow:hidden, so it positions against the viewport, not the parent.
  const [anchor, setAnchor] = useState<{ right: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const openPopover = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchor({
        right: Math.max(8, window.innerWidth - rect.right),
        bottom: window.innerHeight - rect.top + 8,
      });
    }
    setOpen(true);
  };

  const ctx = usage?.context_length ?? contextLength;
  const used = usage?.context_used_tokens ?? draftTokens;
  const pct = ctx ? Math.min(1, used / ctx) : 0;
  const pctRound = Math.round(pct * 100);
  const r = 8;
  const c = 2 * Math.PI * r;
  const over = ctx ? used / ctx >= 0.9 : false;
  const stroke = over ? "var(--hms-error)" : "var(--hms-accent)";

  const cacheRead = usage?.cache_read_tokens ?? 0;
  const cacheWrite = usage?.cache_write_tokens ?? 0;
  const cacheHit = usage && usage.input_tokens > 0
    ? Math.min(100, Math.round((cacheRead / usage.input_tokens) * 100))
    : 0;

  return (
    <div
      style={{ position: "relative", marginRight: 4 }}
      onMouseEnter={openPopover}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openPopover())}
        title={ctx ? `${used.toLocaleString()} / ${ctx.toLocaleString()} tokens` : `${used.toLocaleString()} tokens`}
        style={{ display: "inline-flex", alignItems: "center", border: "none", background: "transparent", cursor: "pointer", color: "var(--hms-text-muted)", padding: 0 }}
      >
        <svg width={22} height={22} viewBox="0 0 22 22" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r={r} fill="none" stroke="var(--hms-border)" strokeWidth="2" />
          {ctx && (
            <circle cx="11" cy="11" r={r} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 11 11)" />
          )}
          {ctx ? (
            <text
              x="11" y="11" textAnchor="middle" dominantBaseline="central"
              style={{ fontSize: 7, fontWeight: 600, fill: "var(--hms-text-muted)" }}
            >
              {pctRound}
            </text>
          ) : null}
        </svg>
      </button>

      {open && (
        <div
          className="hms-popup-panel"
          style={{
            position: "fixed",
            bottom: anchor?.bottom ?? 80,
            right: anchor?.right ?? 16,
            width: 260,
            background: "var(--hms-surface)", border: "1px solid var(--hms-border)",
            borderRadius: 10, boxShadow: "var(--hms-shadow-popover)", zIndex: 9999, padding: "10px 12px",
            display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)', fontSize: 'var(--hms-text-caption)',
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--hms-text)" }}>Context window</div>
          {ctx ? (
            <>
              <MeterLine text={`${pctRound}% used (${Math.max(0, 100 - pctRound)}% left)`} />
              <MeterLine text={`${formatTokens(used)} / ${formatTokens(ctx)} tokens used`} />
              {usage?.auto_compress_at ? (
                <MeterLine
                  text={`Auto-compress at ${formatTokens(usage.auto_compress_at)}${usage.auto_compress_percent ? ` (${usage.auto_compress_percent}%)` : ""}`}
                />
              ) : null}
            </>
          ) : (
            <MeterLine text={`${used.toLocaleString()} tokens used · window unknown`} />
          )}
          {(cacheRead > 0 || cacheWrite > 0) && (
            <MeterLine
              text={`Cache: ${cacheHit}% hit (${formatTokens(cacheRead)} read / ${formatTokens(cacheWrite)} write)`}
            />
          )}
          {usage && (
            <>
              <div style={{ borderTop: "1px solid var(--hms-border)", margin: "2px 0" }} />
              <MeterRow label="Session input" value={usage.input_tokens.toLocaleString()} />
              <MeterRow label="Session output" value={usage.output_tokens.toLocaleString()} />
              <MeterRow label="Session total" value={usage.total_tokens.toLocaleString()} strong />
            </>
          )}
          {!usage && draftTokens > 0 && <MeterLine text={`Draft estimate: ~${draftTokens.toLocaleString()} tokens`} />}
        </div>
      )}
    </div>
  );
}

function MeterLine({ text }: { text: string }) {
  return <div style={{ color: "var(--hms-text-muted)" }}>{text}</div>;
}

function MeterRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", color: strong ? "var(--hms-text)" : "var(--hms-text-muted)", fontWeight: strong ? 600 : 400 }}>
      <span>{label}</span><span style={{ fontFamily: "monospace" }}>{value}</span>
    </div>
  );
}
