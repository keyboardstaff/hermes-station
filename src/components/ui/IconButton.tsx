import type { ButtonHTMLAttributes } from "react";

/**
 * Square icon button — the single home for the 26/32px transparent icon
 * buttons that were hand-rolled across ChatTitleBar, FilesSideTree,
 * SkillsSideList, Channels, Agents, etc. Token-only styling.
 */
export default function IconButton({
  size = "md",
  active = false,
  danger = false,
  style,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "md";
  active?: boolean;
  danger?: boolean;
}) {
  const dim = size === "sm" ? 26 : 32;
  return (
    <button
      type="button"
      className="hms-sidebar-row"
      data-active={active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: dim,
        height: dim,
        flexShrink: 0,
        border: "none",
        borderRadius: "var(--hms-radius-md)",
        background: active ? "var(--hms-selected-bg)" : "transparent",
        color: danger ? "var(--hms-error-text)" : active ? "var(--hms-text)" : "var(--hms-text-muted)",
        cursor: "pointer",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
