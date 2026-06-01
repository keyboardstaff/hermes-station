// edge-swipe gesture for the mobile nav drawer.
// 
// LibreChat-style: dragging from the left edge of the screen opens the
// nav drawer. The trigger is a touchstart with `clientX < 20` followed
// by a sustained horizontal drag past a threshold (60px by default).
// Vertical-dominant motion is rejected so a normal page scroll never
// accidentally opens the drawer.
// 
// We deliberately don't subscribe to mouse events — edge-swipe is a
// touch idiom; using the same handler for mouse would conflict with
// text selection. The drawer's hamburger button is the desktop path.

import { useEffect } from "react";

interface Options {
  /** Pixels from the left edge where a touchstart is eligible. */
  edgeThreshold?: number;
  /** Horizontal pixels travelled before we trigger. */
  triggerDistance?: number;
  /** Max vertical drift before we treat the gesture as a scroll. */
  verticalTolerance?: number;
}

/** Subscribe to the edge-swipe gesture. The callback fires once per
 *  swipe (on triggerDistance crossing); the caller decides what to do
 *  (typically: open the nav drawer). No-op outside a touch environment. */
export function useEdgeSwipe(onSwipe: () => void, opts: Options = {}): void {
  const {
    edgeThreshold = 20,
    triggerDistance = 60,
    verticalTolerance = 40,
  } = opts;

  useEffect(() => {
    if (typeof window === "undefined" || !("ontouchstart" in window)) return;

    let startX = 0;
    let startY = 0;
    let armed = false;
    let triggered = false;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      armed = t.clientX < edgeThreshold;
      triggered = false;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (!armed || triggered) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      // Vertical drift → treat as scroll, disarm.
      if (dy > verticalTolerance) {
        armed = false;
        return;
      }
      if (dx > triggerDistance) {
        triggered = true;
        onSwipe();
      }
    };

    const onEnd = () => {
      armed = false;
      triggered = false;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [onSwipe, edgeThreshold, triggerDistance, verticalTolerance]);
}
