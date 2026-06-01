/**
 * Model chain display for auxiliary and fallback models.
 *
 * Shows the ordered list of models in a chain (title gen, compression,
 * embeddings for auxiliary; fallback chain for the fallback tab).
 * Read-only — editing goes through config.yaml.
 */

interface ChainEntry {
  role: string;
  model: string;
}

interface Props {
  entries: ChainEntry[];
  emptyLabel: string;
}

export default function ModelChain({ entries, emptyLabel }: Props) {
  if (!entries.length) {
    return (
      <div
        style={{
          padding: 'var(--hms-space-6)',
          textAlign: "center",
          color: "var(--hms-text-muted)",
          fontSize: 'var(--hms-text-sm)',
          border: "1px dashed var(--hms-border)",
          borderRadius: 8,
        }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)' }}>
      {entries.map((e, i) => (
        <div
          key={`${e.role}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 'var(--hms-space-3)',
            padding: "10px 14px",
            background: "var(--hms-surface)",
            border: "1px solid var(--hms-border)",
            borderRadius: 8,
          }}
        >
          <span
            style={{
              fontSize: '0.625rem',
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--hms-text-muted)",
              minWidth: 80,
              flexShrink: 0,
            }}
          >
            {e.role}
          </span>
          <span
            style={{
              flex: 1,
              fontFamily: "monospace",
              fontSize: 'var(--hms-text-caption)',
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {e.model}
          </span>
          <span
            style={{
              fontSize: 'var(--hms-text-xs)',
              color: "var(--hms-text-muted)",
              flexShrink: 0,
            }}
          >
            #{i + 1}
          </span>
        </div>
      ))}
    </div>
  );
}
