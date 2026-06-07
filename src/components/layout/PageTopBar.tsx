import type { ReactNode, CSSProperties } from "react";
import ProfileScopeSelector from "@/components/chat/ProfileScopeSelector";

/**
 * PageTopBar — the single "page top protocol" for every routed panel.
 *
 * Replaces the lightweight inline `PageHeader`, the bespoke `ChatTitleBar`
 * shell, and the hand-rolled toolbars in Sessions / Cron / Logs. It owns
 * the shared bar height (`--hms-header-h`), the bottom border, the title /
 * actions areas, and an optional full-width `context` row beneath the bar
 * (for filters, tabs, breadcrumbs — anything a page needs its own line for).
 *
 * Layout (the header row is ALWAYS `--hms-header-h` with
 * its own border, so every page's title bar lines up at the same height
 * whether or not it has a `context` row; the optional context row sits below
 * as a distinct band):
 *   ┌───────────────────────────────────────────────┐
 *   │ [leading] title · subtitle      …      actions │  ← header row (header-h, bordered)
 *   ├───────────────────────────────────────────────┤
 *   │ context (optional: filters / tabs / breadcrumb)│  ← second band, bordered
 *   └───────────────────────────────────────────────┘
 *
 * Convention (see docs/UI_CONVENTIONS.md):
 *   • `actions`  = page-level *actions* — primary (`<Button variant="primary">`),
 *     batch (export / delete), and a trailing `<IconButton>` refresh.
 *   • `context`  = *view controls* — filters, tabs, board/time selectors,
 *     breadcrumbs. Not actions.
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
  showProfileScope = false,
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
  /** Show the profile view-scope picker in the actions area — for pages whose
   *  data is profile-scoped (skills / models / cron / mcp / files). Self-hides
   *  for single-profile users, so it's a no-op there. */
  showProfileScope?: boolean;
}) {
  return (
    <div className="hms-page-topbar" style={style}>
      <div className="hms-page-topbar-head">
        {leading}
        <div className="hms-page-topbar-title">
          <h1 className="hms-page-topbar-heading">{title}</h1>
          {subtitle && (
            <span className="hms-page-topbar-subtitle">{subtitle}</span>
          )}
        </div>
        {(showProfileScope || actions) && (
          <div className="hms-page-topbar-actions">
            {showProfileScope && <ProfileScopeSelector fullWidth={false} />}
            {actions}
          </div>
        )}
      </div>
      {context && (
        <div className="hms-page-topbar-context">{context}</div>
      )}
    </div>
  );
}
