import type { ReactNode } from "react";

/** Card wrapper shared across the Settings tabs (Preferences / Security / System). */
export function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--hms-border)",
        borderRadius: 10,
        padding: "14px 16px",
        background: "var(--hms-surface)",
        display: "flex",
        flexDirection: "column",
        gap: 'var(--hms-space-3)',
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', fontSize: 'var(--hms-text-sm)', fontWeight: 600 }}>
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
