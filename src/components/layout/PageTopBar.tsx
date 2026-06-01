import type { ReactNode, CSSProperties } from "react";

/**
 * PageTopBar — the single "page top protocol" for every routed panel.
 *
 * Replaces the lightweight inline `PageHeader`, the bespoke `ChatTitleBar`
 * shell, and the hand-rolled toolbars in Sessions / Cron / Logs. It owns
 * the shared bar height (`--hms-header-h`), the bottom border, the title /
 * actions areas, and an optional full-width `context` row beneath the bar
 * (for filters, tabs, breadcrumbs — anything a page needs its own line for).
 *
 * Layout:
 *   ┌───────────────────────────────────────────────┐
 *   │ [leading] title · subtitle      …      actions │  ← header row (header-h)
 *   ├───────────────────────────────────────────────┤
 *   │ context (optional, full width)                 │
 *   └───────────────────────────────────────────────┘
 *
 * Panels render `<PageTopBar/>` then a flex-1 scroll body below it.
 */
export default function PageTopBar({
  title,
  subtitle,
  leading,
  actions,
  context,
  style,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Slot before the title (icon, back button, profile picker, …). */
  leading?: ReactNode;
  /** Right-aligned actions. */
  actions?: ReactNode;
  /** Full-width row below the header (filters, tabs, breadcrumb). */
  context?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ flexShrink: 0, ...style }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--hms-space-2)",
          minHeight: "var(--hms-header-h, 48px)",
          padding: "0 var(--hms-space-4)",
          borderBottom: context ? "none" : "1px solid var(--hms-border)",
        }}
      >
        {leading}
        <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "baseline", gap: "var(--hms-space-2)" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "var(--hms-text-body)",
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <span
              style={{
                fontSize: "var(--hms-text-xs)",
                color: "var(--hms-text-muted)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
        {actions && (
          <div style={{ display: "flex", gap: "var(--hms-space-1)", alignItems: "center", flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
      {context && (
        <div style={{ borderBottom: "1px solid var(--hms-border)", padding: "var(--hms-space-2) var(--hms-space-4)" }}>
          {context}
        </div>
      )}
    </div>
  );
}
