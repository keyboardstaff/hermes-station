import type { StatusTone } from "./StatusDot";

const TONE: Record<StatusTone, { fg: string; bg: string }> = {
  success: { fg: "var(--hms-success-text)", bg: "var(--hms-success-weak)" },
  warning: { fg: "var(--hms-warning-text)", bg: "var(--hms-warning-weak)" },
  error: { fg: "var(--hms-error-text)", bg: "var(--hms-error-weak)" },
  accent: { fg: "var(--hms-accent)", bg: "var(--hms-accent-weak)" },
  muted: { fg: "var(--hms-text-muted)", bg: "var(--hms-hover-bg)" },
};

/**
 * Small pill badge — active/inactive, default, source, count. The single home
 * for the inline `padding+radius+rgba` pills across Skills/Profile/Models/Channels.
 */
export default function StatusBadge({
  tone = "muted",
  children,
  uppercase = true,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  uppercase?: boolean;
}) {
  const c = TONE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        borderRadius: "var(--hms-radius-sm)",
        fontSize: "0.625rem",
        fontWeight: 600,
        letterSpacing: uppercase ? "0.04em" : undefined,
        textTransform: uppercase ? "uppercase" : undefined,
        color: c.fg,
        background: c.bg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
