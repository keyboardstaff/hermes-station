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
        : "var(--hms-muted)";

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
      className="hms-channel-card"
      style={{
        borderTop: `3px solid ${statusColor}`,
      }}
    >
      {/* Header: icon + name + kind badge */}
      <div className="hms-channel-card-head">
        <StatusIcon size={18} style={{ color: statusColor, flexShrink: 0, marginTop: 2 }} />
        <div className="hms-channel-card-copy">
          <div className="hms-channel-card-title">{label}</div>
          <code className="hms-channel-card-id">{name}</code>
        </div>
        <span className="hms-channel-card-kind">
          {kind === "plugin" ? labels.plugin : labels.builtin}
        </span>
      </div>

      {/* Status badge */}
      <div>
        <span
          className="hms-channel-card-status"
          style={{
            color: statusColor,
            background: `${statusColor}1a`,
            border: `1px solid ${statusColor}33`,
          }}
        >
          {statusLabel}
        </span>
      </div>

      {/* Runtime details */}
      {runtime && (
        <div className="hms-channel-card-details">
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
              <span className="hms-channel-card-error-label">
                <AlertTriangle size={11} /> {labels.lastError}
              </span>
              <span className="hms-channel-card-error-copy">{String(runtime.last_error)}</span>
            </>
          )}
        </div>
      )}

      {/* Circuit breaker hint */}
      {circuitFlag && (isCircuitOpen || isBroken) && (
        <div className="hms-channel-card-warning">
          {isCircuitOpen ? <Pause size={11} /> : <Play size={11} />}
          <span>{labels.circuitHint}</span>
          <ExternalLink size={10} style={{ marginLeft: "auto", color: "var(--hms-text-muted)" }} />
        </div>
      )}
    </div>
  );
}
