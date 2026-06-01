/**
 * Pareto Code Router slider.
 *
 * Only rendered when ``shim.flags.pareto_code_router`` is true (v0.14+).
 * Controls the ``min_coding_score`` threshold for the OpenRouter Pareto
 * code routing heuristic. Read-only display for now — value comes from
 * config.yaml. Editing is via the Config tab.
 */

interface Props {
  value: number;
  enabled: boolean;
  labels: {
    title: string;
    disabled: string;
    description: string;
  };
}

export default function ParetoSlider({ value, enabled, labels }: Props) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--hms-surface)",
        border: "1px solid var(--hms-border)",
        borderRadius: 10,
        opacity: enabled ? 1 : 0.5,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 'var(--hms-text-caption)', fontWeight: 600 }}>{labels.title}</span>
        {!enabled && (
          <span style={{ fontSize: '0.625rem', color: "var(--hms-warning)" }}>{labels.disabled}</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-3)' }}>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(value * 100)}
          disabled
          style={{
            flex: 1,
            accentColor: "var(--hms-accent)",
            cursor: "default",
          }}
        />
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 'var(--hms-text-caption)',
            minWidth: 36,
            textAlign: "right",
          }}
        >
          {(value * 100).toFixed(0)}%
        </span>
      </div>

      <div style={{ fontSize: '0.625rem', color: "var(--hms-text-muted)", marginTop: 6 }}>
        {labels.description}
      </div>
    </div>
  );
}
