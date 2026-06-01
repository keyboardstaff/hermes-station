import { ChevronLeft } from "lucide-react";
import { useI18n } from "@/i18n";

/**
 * mobile shim for SidePanel-style routes.
 *
 * Desktop renders ``ProfileSideList`` / ``CronSideList`` / ``FilesSideTree``
 * / ``SkillsSideList`` in the persistent ``<SidePanel>`` and the detail
 * pane in ``<main>`` side-by-side. Mobile has no SidePanel slot, so we
 * use a list-then-detail pattern:
 *
 *   • ``hasSelection === false`` → render the **side list** as the whole
 *     main column. Tapping an item flips selection via the route's
 *     zustand store.
 *   • ``hasSelection === true``  → render the **detail panel** with a
 *     compact back bar at the top whose only job is to clear the
 *     selection (so the user lands back on the list).
 *
 * The wrapper is intentionally dumb — it doesn't subscribe to any
 * store; the caller computes ``hasSelection`` from whichever store
 * belongs to the route. Keeps the wrapper reusable across all four
 * SidePanel routes without coupling it to a specific selection shape.
 *
 * `backBar` overrides the default chevron+label row when a route has
 * richer breadcrumb context to surface (e.g. `/files` injects a
 * `FileBreadcrumb` so users see the path, not just "Back").
 */
export default function MobileListDetail({
  hasSelection,
  onBack,
  side,
  detail,
  backLabel,
  backBar,
}: {
  hasSelection: boolean;
  /** Called when the user taps the back chevron. Should clear the
   *  route's zustand selection so ``hasSelection`` flips to false. */
  onBack: () => void;
  /** The side-list component instance (e.g. ``<ProfileSideList />``). */
  side: React.ReactNode;
  /** The detail panel instance (e.g. ``<ProfilePanel />``). */
  detail: React.ReactNode;
  /** Optional explicit back-bar label override. Defaults to the i18n
   *  "Back" string. */
  backLabel?: string;
  /** Optional replacement for the entire back-bar (e.g. a breadcrumb).
   *  The override must call ``onBack`` itself — this wrapper does not
   *  inject a chevron when ``backBar`` is set. */
  backBar?: React.ReactNode;
}) {
  const { t } = useI18n();

  if (!hasSelection) {
    return <div style={{ height: "100%", overflow: "hidden" }}>{side}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {backBar ?? (
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel ?? t.common.back}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--hms-space-1)",
            padding: "8px 12px",
            border: "none",
            borderBottom: "1px solid var(--hms-border)",
            background: "var(--hms-surface)",
            color: "var(--hms-text)",
            cursor: "pointer",
            fontSize: "var(--hms-text-sm)",
            flexShrink: 0,
            textAlign: "left",
          }}
        >
          <ChevronLeft size={16} />
          {backLabel ?? t.common.back}
        </button>
      )}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>{detail}</div>
    </div>
  );
}
