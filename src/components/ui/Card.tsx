import type { CSSProperties, ReactNode } from "react";

/**
 * Bordered surface container — the single home for the
 * `border + radius + surface` blocks repeated across Models / Analytics /
 * Channels / Agents / Skills cards. Token-only.
 */
export default function Card({
  children,
  padding = true,
  style,
  onClick,
  accent,
}: {
  children: ReactNode;
  padding?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
  /** Optional left status stripe colour (token var). */
  accent?: string;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        border: "1px solid var(--hms-border)",
        borderLeft: accent ? `3px solid ${accent}` : undefined,
        borderRadius: "var(--hms-card-radius, var(--hms-radius-lg))",
        background: "var(--hms-surface)",
        padding: padding ? "var(--hms-card-padding, var(--hms-space-4))" : 0,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
