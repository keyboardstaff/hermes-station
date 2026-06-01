import type { ReactNode } from "react";

/**
 * Form field row — uppercase label above a control. The single home for the
 * label+control pattern in Settings / Plugins / Models forms. Token-only.
 */
export default function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-1)" }}>
      <span style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--hms-text-muted)" }}>
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)" }}>{hint}</span>}
    </label>
  );
}
