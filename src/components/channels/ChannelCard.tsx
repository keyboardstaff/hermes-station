import {
  Radio,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pause,
  Play,
  ExternalLink,
} from "lucide-react";

// Shape of /api/dashboard/status's gateway_platforms entries.
export interface PlatformRuntime {
  status?: string;
  enabled?: boolean;
  last_error?: string | null;
  last_seen_at?: string | null;
  inflight?: number;
  [key: string]: unknown;
}

export interface ChannelCardLabels {
  builtin: string;
  plugin: string;
  running: string;
  stopped: string;
  broken: string;
  circuitOpen: string;
  statusUnknown: string;
  inflight: string;
  lastSeen: string;
  lastError: string;
  circuitHint: string;
  upstreamHint: string;
}

/**
 * ChannelCard — single platform card for the channels grid.
 *
 * Displays: platform name + kind badge, status badge, runtime details,
 * and circuit-breaker hint when applicable.
 */
export default function ChannelCard({
  name,
  label,
  kind,
  runtime,
  circuitFlag,
  labels,
}: {
  name: string;
  label: string;
  kind: string;
  runtime: PlatformRuntime | undefined;
  circuitFlag: boolean;
  labels: ChannelCardLabels;
}) {
  const status = runtime?.status?.toLowerCase() ?? "unknown";
  const isRunning = status === "running" || status === "ok";
  const isCircuitOpen = status === "circuit_open" || status === "open";
  const isBroken = status === "broken" || status === "error";
  const isStopped = status === "stopped" || status === "off" || !runtime;

  const statusLabel = isRunning
    ? labels.running
    : isCircuitOpen
      ? labels.circuitOpen
      : isBroken
        ? labels.broken
        : isStopped
          ? labels.stopped
          : labels.statusUnknown;

  const statusColor = isRunning
    ? "var(--hms-success)"
    : isCircuitOpen
      ? "var(--hms-warning)"
      : isBroken
        ? "var(--hms-error)"
        : "#94a3b8";

  const StatusIcon = isRunning
    ? CheckCircle2
    : isCircuitOpen
      ? AlertTriangle
      : isBroken
        ? XCircle
        : Radio;

  const formatTs = (iso?: string | null): string => {
    if (!iso) return "--";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return iso;
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return `${Math.round(diff)}s`;
    if (diff < 3600) return `${Math.round(diff / 60)}m`;
    return `${Math.round(diff / 3600)}h`;
  };

  return (
    <div
      style={{
        padding: "16px",
        background: "var(--hms-surface)",
        border: `1px solid var(--hms-border)`,
        borderTop: `3px solid ${statusColor}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: "var(--hms-space-3)",
        minWidth: 0,
      }}
    >
      {/* Header: icon + name + kind badge */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--hms-space-2)" }}>
        <StatusIcon size={18} style={{ color: statusColor, flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--hms-text-body)",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
          <code style={{ fontSize: "0.625rem", color: "var(--hms-text-muted)" }}>{name}</code>
        </div>
        <span
          style={{
            fontSize: "0.5625rem",
            padding: "2px 6px",
            borderRadius: 3,
            background: "var(--hms-border)",
            color: "var(--hms-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {kind === "plugin" ? labels.plugin : labels.builtin}
        </span>
      </div>

      {/* Status badge */}
      <div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--hms-space-1)",
            fontSize: "var(--hms-text-xs)",
            padding: "3px 8px",
            borderRadius: 12,
            color: statusColor,
            background: `${statusColor}1a`,
            border: `1px solid ${statusColor}33`,
            fontWeight: 600,
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Runtime details */}
      {runtime && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            rowGap: 4,
            columnGap: 12,
            fontSize: "var(--hms-text-xs)",
            color: "var(--hms-text-muted)",
          }}
        >
          {runtime.last_seen_at && (
            <>
              <span>{labels.lastSeen}</span>
              <span>{formatTs(runtime.last_seen_at)}</span>
            </>
          )}
          {runtime.inflight != null && (
            <>
              <span>{labels.inflight}</span>
              <span>{String(runtime.inflight)}</span>
            </>
          )}
          {runtime.last_error && (
            <>
              <span
                style={{
                  color: "var(--hms-error-text)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--hms-space-1)",
                }}
              >
                <AlertTriangle size={11} /> {labels.lastError}
              </span>
              <span
                style={{
                  fontFamily: "monospace",
                  color: "var(--hms-error-text)",
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                }}
              >
                {String(runtime.last_error)}
              </span>
            </>
          )}
        </div>
      )}

      {/* Circuit breaker hint */}
      {circuitFlag && (isCircuitOpen || isBroken) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--hms-space-2)",
            padding: "6px 8px",
            background: "rgba(245,158,11,0.06)",
            border: "1px solid rgba(245,158,11,0.18)",
            borderRadius: 6,
            fontSize: "var(--hms-text-xs)",
            color: "var(--hms-warning-text)",
          }}
        >
          {isCircuitOpen ? <Pause size={11} /> : <Play size={11} />}
          <span>{labels.circuitHint}</span>
          <ExternalLink size={10} style={{ marginLeft: "auto", color: "var(--hms-text-muted)" }} />
        </div>
      )}
    </div>
  );
}
