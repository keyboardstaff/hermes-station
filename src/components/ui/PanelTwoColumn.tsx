import { type ReactNode } from "react";
import { useIsMobile } from "@/hooks/useBreakpoint";
import MobileListDetail from "@/components/layout/MobileListDetail";

/**
 * List + detail two-column panel — the primitive that replaces the
 * legacy global SidePanel slot. Each route's panel pulls its own
 * selection store and renders its own side list / detail body, then
 * wraps them in this primitive. Keeps the wiring uniform across
 * Cron / Files / Skills / Profile (and any future list-detail panel).
 *
 * Desktop: fixed-width left list + flexible detail right (no drag-resize).
 * Mobile:  list↔detail flow via existing MobileListDetail so behaviour
 *          stays identical to the previous MobileShell wrappers.
 *
 * `hasSelection` + `onBack` exist so mobile knows whether to render
 * list or detail. On desktop they're ignored.
 */
export default function PanelTwoColumn({
  list,
  detail,
  hasSelection,
  onBack,
  listWidth,
  mobileBackBar,
}: {
  list: ReactNode;
  detail: ReactNode;
  hasSelection: boolean;
  onBack: () => void;
  /** Override the fixed desktop list column width. Defaults to --hms-panel-list-w (280px). */
  listWidth?: number | string;
  /** Optional richer back-bar for mobile detail view (e.g. breadcrumb).
   *  Ignored on desktop. */
  mobileBackBar?: ReactNode;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <MobileListDetail
        hasSelection={hasSelection}
        onBack={onBack}
        side={list}
        detail={detail}
        backBar={mobileBackBar}
      />
    );
  }

  return (
    <div className="hms-two-col">
      <aside className="hms-two-col-list" style={{ width: listWidth ?? "var(--hms-panel-list-w, 280px)" }}>
        {list}
      </aside>
      <div className="hms-two-col-sep" />
      <main className="hms-two-col-detail">{detail}</main>
    </div>
  );
}
