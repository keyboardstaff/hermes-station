/**
 * Cost estimate card.
 *
 * Renders estimated vs actual cost and session count in a compact row.
 * Values come from upstream `/api/analytics/usage` totals.
 */

interface Props {
  estimated?: number;
  actual?: number;
  sessions?: number;
  labels: {
    estimated: string;
    actual: string;
    sessions: string;
  };
}

function fmtCost(n?: number): string {
  if (n == null) return "--";
  return "$" + n.toFixed(2);
}

export default function CostCard({ estimated, actual, sessions, labels }: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 'var(--hms-space-3)',
      }}
    >
      <Metric label={labels.estimated} value={fmtCost(estimated)} />
      <Metric label={labels.actual} value={fmtCost(actual)} />
      <Metric label={labels.sessions} value={sessions != null ? String(sessions) : "--"} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--hms-text-lg)', fontWeight: 700 }}>{value}</div>
    </div>
  );
}
