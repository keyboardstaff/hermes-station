import { Clock } from "lucide-react";

export interface CronTemplate {
  label: string;
  schedule: string;
  prompt: string;
  name: string;
}

export const CRON_TEMPLATES: CronTemplate[] = [
  {
    label: "Daily brief",
    schedule: "0 9 * * *",
    prompt: "Write a concise morning summary: current date, top priorities, and any pending tasks. Save it to DAILY_BRIEF.md.",
    name: "Daily brief at 9am",
  },
  {
    label: "Weekly review",
    schedule: "0 9 * * 1",
    prompt: "Perform a weekly retrospective: summarise completed work, identify blockers, and outline next week's goals. Save to WEEKLY_REVIEW.md.",
    name: "Weekly review",
  },
  {
    label: "File cleanup",
    schedule: "0 0 * * 0",
    prompt: "Remove temp files and empty directories from ~/workspace/tmp/. Report the number of items removed.",
    name: "Weekly file cleanup",
  },
];

/**
 * CronEmptyTemplates — empty state for the cron detail pane when no jobs exist.
 *
 * Shows an icon, headline, and template CTA buttons that call back with
 * pre-filled schedule/prompt/name so the caller can open CronCreateDialog.
 */
export default function CronEmptyTemplates({
  onTemplate,
  onNew,
  labels,
}: {
  /** Called with prefilled template values; caller opens CronCreateDialog. */
  onTemplate: (t: CronTemplate) => void;
  /** Called when the user clicks "+ New job" (custom). */
  onNew: () => void;
  labels: {
    empty: string;
    createFirst: string;
    newJob: string;
  };
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        gap: "var(--hms-space-4)",
        textAlign: "center",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--hms-surface-hover)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Clock size={24} style={{ color: "var(--hms-text-muted)" }} />
      </div>

      {/* Headline */}
      <div>
        <div style={{ fontWeight: 600, fontSize: "var(--hms-text-body)", marginBottom: 4 }}>
          {labels.empty}
        </div>
        <div style={{ fontSize: "var(--hms-text-sm)", color: "var(--hms-text-muted)" }}>
          {labels.createFirst}
        </div>
      </div>

      {/* Template buttons */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--hms-space-2)",
          justifyContent: "center",
          maxWidth: 480,
        }}
      >
        {CRON_TEMPLATES.map((tpl) => (
          <button
            key={tpl.label}
            type="button"
            onClick={() => onTemplate(tpl)}
            style={{
              padding: "8px 16px",
              border: "1px solid var(--hms-border)",
              borderRadius: 20,
              background: "var(--hms-surface)",
              color: "var(--hms-text)",
              fontSize: "var(--hms-text-sm)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--hms-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--hms-surface)";
            }}
          >
            {tpl.label}
          </button>
        ))}
      </div>

      {/* Divider + new job button */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--hms-space-3)",
          color: "var(--hms-text-muted)",
          fontSize: "var(--hms-text-xs)",
          width: "100%",
          maxWidth: 240,
        }}
      >
        <div style={{ flex: 1, height: 1, background: "var(--hms-border)" }} />
        <span>or</span>
        <div style={{ flex: 1, height: 1, background: "var(--hms-border)" }} />
      </div>

      <button
        type="button"
        onClick={onNew}
        style={{
          padding: "8px 20px",
          borderRadius: 8,
          border: "1px solid var(--hms-border)",
          background: "var(--hms-bg)",
          color: "var(--hms-text)",
          fontSize: "var(--hms-text-sm)",
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        + {labels.newJob}
      </button>
    </div>
  );
}
