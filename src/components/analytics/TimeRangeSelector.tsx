/**
 * time-range toggle: 7d / 30d / 90d.
 *
 * Renders a row of toggle buttons. The active range is highlighted with
 * the station accent colour; the rest use muted styling.
 */

export type TimeRange = 7 | 30 | 90;

const RANGES: TimeRange[] = [7, 30, 90];

interface Props {
  value: TimeRange;
  onChange: (r: TimeRange) => void;
  labels: Record<TimeRange, string>;
}

export default function TimeRangeSelector({ value, onChange, labels }: Props) {
  return (
    <div style={{ display: "flex", gap: 'var(--hms-space-1)' }}>
      {RANGES.map((r) => {
        const active = r === value;
        return (
          <button
            key={r}
            onClick={() => onChange(r)}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: "1px solid var(--hms-border)",
              background: active ? "var(--hms-text)" : "transparent",
              color: active ? "var(--hms-bg)" : "var(--hms-text-muted)",
              fontSize: 'var(--hms-text-caption)',
              fontWeight: active ? 600 : 400,
              cursor: "pointer",
              transition: "all 120ms",
            }}
          >
            {labels[r]}
          </button>
        );
      })}
    </div>
  );
}
