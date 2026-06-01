import { useEffect } from "react";
import type { ReactNode } from "react";

/**
 * Generic left-side slide-in Drawer for mobile.
 *
 * The Drawer is content-agnostic — MobileShell passes a `<Sidebar />`
 * instance as children. Backdrop click / Escape / body scroll-lock are
 * handled here so neither the Sidebar nor the Shell has to know about
 * mobile chrome.
 *
 * Width tracks --hms-mobile-drawer-w (80vw) capped by
 * --hms-mobile-drawer-max (360px).
 */
export default function Drawer({
  open,
  onClose,
  children,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <div
      className="hms-drawer-root"
      data-open={open}
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
      aria-label={ariaLabel}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: open ? "auto" : "none",
        zIndex: "var(--hms-z-drawer, 30)" as unknown as number,
      }}
    >
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          opacity: open ? 1 : 0,
          transition: "opacity var(--hms-duration-base, 200ms) var(--hms-ease-standard, ease)",
        }}
      />
      <aside
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: "min(var(--hms-mobile-drawer-w, 80vw), var(--hms-mobile-drawer-max, 360px))",
          background: "var(--hms-bg)",
          boxShadow: "0 0 24px rgba(0,0,0,0.18)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform var(--hms-duration-base, 200ms) var(--hms-ease-standard, ease)",
          paddingTop: "var(--hms-safe-top, 0px)",
          paddingBottom: "var(--hms-safe-bottom, 0px)",
        }}
      >
        {children}
      </aside>
    </div>
  );
}
