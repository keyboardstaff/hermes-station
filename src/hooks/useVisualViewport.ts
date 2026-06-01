// mobile keyboard compensation.
// 
// iOS Safari + Android Chrome shrink `visualViewport.height` when the
// soft keyboard slides up, but `window.innerHeight` stays at the
// pre-keyboard value. Components that need to keep their bottom edge
// above the keyboard (Composer, ApprovalSheet) read the difference
// from a CSS custom property we publish on <html>:
// 
//   --hms-keyboard-h: 0px              when no keyboard
//   --hms-keyboard-h: <height>px       when the keyboard is up
// 
// `position: fixed; bottom: var(--hms-keyboard-h)` then "just works"
// across iOS / Android. We use a CSS var instead of a React state
// because the value is read by deeply-nested elements (Composer)
// where prop-drilling would be noisy.
// 
// We also expose the same value as a hook return so unit tests can
// assert on it without scraping the DOM.

import { useEffect, useState } from "react";

const CSS_VAR = "--hms-keyboard-h";

/** Update the CSS var + return the current keyboard height in px.
 *
 *  Mount once at the top of the React tree (App / ResponsiveShell).
 *  Idempotent — listening twice is harmless. Returns 0 in environments
 *  without `window.visualViewport` (older browsers, jsdom). */
export function useVisualViewport(): number {
  const [kbh, setKbh] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;

    const update = () => {
      // Difference between layout viewport and visual viewport gives the
      // keyboard intrusion. `Math.max(0, …)` guards against transient
      // negatives during the iOS bounce-scroll animation.
      const h = Math.max(0, window.innerHeight - vv.height);
      document.documentElement.style.setProperty(CSS_VAR, `${h}px`);
      setKbh(h);
    };
    // Initialise to 0 so the var is always set (avoids the "var(--x)" no-op).
    document.documentElement.style.setProperty(CSS_VAR, "0px");
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return kbh;
}
