/**
 * single cron job row in the side list.
 *
 * Compact card: state dot, name, schedule, last-run badge.
 * Click selects; double-click triggers immediately.
 */

import { PauseCircle, AlertCircle, CheckCircle2 } from "lucide-react";
import type { CronJob } from "@/hooks/useCron";

interface Props {
  job: CronJob;
  selected: boolean;
  onSelect: () => void;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "--";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "--";
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return `${Math.round(diff / 86400)}d`;
}

export default function CronJobRow({ job, selected, onSelect }: Props) {
  const enabled = job.enabled !== false && job.state !== "paused";
  const errored = job.last_status === "error";

  return (
    <button
      onClick={onSelect}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        gap: 'var(--hms-space-2)',
        padding: "8px 10px",
        background: selected ? "var(--hms-border)" : "transparent",
        border: "1px solid transparent",
        borderLeft: `3px solid ${
          errored ? "var(--hms-error)" : enabled ? "var(--hms-success)" : "var(--hms-warning)"
        }`,
        borderRadius: 6,
        cursor: "pointer",
        color: "var(--hms-text)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 'var(--hms-space-1)',
            fontSize: 'var(--hms-text-caption)',
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {job.state === "paused" && (
            <PauseCircle size={11} style={{ color: "var(--hms-warning)", flexShrink: 0 }} />
          )}
          {errored && (
            <AlertCircle size={11} style={{ color: "var(--hms-error)", flexShrink: 0 }} />
          )}
          {!errored && job.last_status === "ok" && (
            <CheckCircle2 size={11} style={{ color: "var(--hms-success)", flexShrink: 0 }} />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {job.name || job.id}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: '0.625rem',
            color: "var(--hms-text-muted)",
            marginTop: 2,
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 130,
            }}
          >
            {job.schedule_display || job.schedule?.display || job.schedule?.expr || "--"}
          </span>
          <span>{relativeTime(job.last_run_at)}</span>
        </div>
      </div>
    </button>
  );
}
