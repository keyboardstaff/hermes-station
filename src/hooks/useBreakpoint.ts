// viewport-driven layout switch.
// 
// The proposal defines three viewport bands:
//   ≤  960px  → "mobile"  (MobileShell: floating header + slide-in drawer)
//   ≤ 1024px  → "tablet"  (DesktopShell in compact mode — sidebar icon-only)
//   ≥ 1025px  → "desktop" (DesktopShell — full 260px sidebar)
// 
// We use matchMedia rather than window.innerWidth so layout flips cleanly
// at the breakpoint without a debounced resize handler. Each breakpoint
// is exposed as its own boolean so components can subscribe to just the
// transition they care about.

import { useEffect, useState } from "react";

export type Breakpoint = "mobile" | "tablet" | "desktop";

// Single source of truth — change a query here and every consumer follows.
// Kept aligned with the values in `src/styles/mobile.css`.
const QUERIES = {
  mobile:  "(max-width: 960px)",
  tablet:  "(min-width: 961px) and (max-width: 1024px)",
} as const;

function detect(): Breakpoint {
  if (typeof window === "undefined" || !window.matchMedia) return "desktop";
  if (window.matchMedia(QUERIES.mobile).matches) return "mobile";
  if (window.matchMedia(QUERIES.tablet).matches) return "tablet";
  return "desktop";
}

/** Live breakpoint — re-renders the consumer when the viewport crosses
 *  a query boundary. Falls back to "desktop" during SSR (typeof window
 *  guard) so first-paint is deterministic. */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => detect());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mqMobile = window.matchMedia(QUERIES.mobile);
    const mqTablet = window.matchMedia(QUERIES.tablet);
    const update = () => setBp(detect());
    mqMobile.addEventListener("change", update);
    mqTablet.addEventListener("change", update);
    return () => {
      mqMobile.removeEventListener("change", update);
      mqTablet.removeEventListener("change", update);
    };
  }, []);

  return bp;
}

/** Sugar — most consumers only care "am I mobile?". Avoids `bp === "mobile"`
 *  checks at every call site. */
export function useIsMobile(): boolean {
  return useBreakpoint() === "mobile";
}
