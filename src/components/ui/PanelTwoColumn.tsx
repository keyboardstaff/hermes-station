import { type ReactNode, useCallback, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useBreakpoint";
import MobileListDetail from "@/components/layout/MobileListDetail";

const LIST_MIN = 180;
const LIST_MAX = 400;

function readStoredWidth(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  const stored = localStorage.getItem(`hms-panel-list-w:${key}`);
  if (!stored) return fallback;
  const n = parseInt(stored, 10);
  return isNaN(n) ? fallback : Math.max(LIST_MIN, Math.min(LIST_MAX, n));
}

/**
 * List + detail two-column panel — the primitive that replaces the
 * legacy global SidePanel slot. Each route's panel pulls its own
 * selection store and renders its own side list / detail body, then
 * wraps them in this primitive. Keeps the wiring uniform across
 * Cron / Files / Skills / Profile (and any future list-detail panel).
 *
 * Desktop: fixed-width left list + flexible detail right.
 * Mobile:  list↔detail flow via existing MobileListDetail so behaviour
 *          stays identical to the previous MobileShell wrappers.
 *
 * `hasSelection` + `onBack` exist so mobile knows whether to render
 * list or detail. On desktop they're ignored.
 *
 * `storageKey` enables persisting the dragged list width to localStorage.
 */
export default function PanelTwoColumn({
  list,
  detail,
  hasSelection,
  onBack,
  listWidth,
  storageKey,
  mobileBackBar,
}: {
  list: ReactNode;
  detail: ReactNode;
  hasSelection: boolean;
  onBack: () => void;
  /** Override desktop list column width. Defaults to --hms-panel-list-w (280px). */
  listWidth?: number | string;
  /** localStorage key suffix for persisting dragged width. Enables drag handle. */
  storageKey?: string;
  /** Optional richer back-bar for mobile detail view (e.g. breadcrumb).
   *  Ignored on desktop. */
  mobileBackBar?: ReactNode;
}) {
  const isMobile = useIsMobile();
  const defaultW = typeof listWidth === "number" ? listWidth : 280;
  const [width, setWidth] = useState(() => readStoredWidth(storageKey, defaultW));
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [width]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    const newW = Math.max(LIST_MIN, Math.min(LIST_MAX, startW.current + delta));
    setWidth(newW);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    const delta = e.clientX - startX.current;
    const newW = Math.max(LIST_MIN, Math.min(LIST_MAX, startW.current + delta));
    if (storageKey) localStorage.setItem(`hms-panel-list-w:${storageKey}`, String(newW));
  }, [storageKey]);

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

  const resolvedWidth = storageKey ? width : (listWidth ?? "var(--hms-panel-list-w, 280px)");

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <aside
        style={{
          width: resolvedWidth,
          flexShrink: 0,
          overflow: "auto",
          minHeight: 0,
        }}
      >
        {list}
      </aside>
      {storageKey ? (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            width: 5,
            flexShrink: 0,
            cursor: "col-resize",
            background: "transparent",
            borderRight: "1px solid var(--hms-border)",
            transition: "background var(--hms-duration-fast)",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--hms-hover-bg)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
        />
      ) : (
        <div style={{ width: 1, flexShrink: 0, background: "var(--hms-border)" }} />
      )}
      <main style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
        {detail}
      </main>
    </div>
  );
}
