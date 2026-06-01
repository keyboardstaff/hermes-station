/**
 * Status dot + optional label — the single home for the running/stopped/
 * enabled indicators repeated across Profile (gateway), Skills, Cron, Group.
 * `tone` maps to a semantic token; `filled` shows ● vs ○.
 */
export type StatusTone = "success" | "warning" | "error" | "accent" | "muted";

const TONE_VAR: Record<StatusTone, string> = {
  success: "var(--hms-success)",
  warning: "var(--hms-warning)",
  error: "var(--hms-error)",
  accent: "var(--hms-accent)",
  muted: "var(--hms-muted)",
};

export default function StatusDot({
  tone,
  label,
  filled = true,
}: {
  tone: StatusTone;
  label?: string;
  filled?: boolean;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--hms-space-1)", fontSize: "var(--hms-text-caption)", color: label ? "var(--hms-text-muted)" : undefined }}>
      <span style={{ color: TONE_VAR[tone], lineHeight: 1 }}>{filled ? "●" : "○"}</span>
      {label}
    </span>
  );
}
