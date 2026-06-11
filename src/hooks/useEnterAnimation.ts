import { useCallback, useRef } from "react";

// One-shot enter animation via the Web Animations API, ported from upstream
// desktop. A callback ref plays a 180ms fade+rise exactly once when the
// element first attaches; an `animationKey` remembers played entries so a
// re-render (or branch switch) never replays it. CSS transitions are fragile
// here — streaming deltas constantly invalidate ancestor state, which can
// re-trigger transitions on unrelated descendants; el.animate() runs against
// the element directly and is independent of CSS rule churn.

const playedKeys = new Set<string>();
const playedOrder: string[] = [];
const MAX_TRACKED_KEYS = 2048;

function rememberPlayed(key: string): void {
  if (playedKeys.has(key)) return;
  playedKeys.add(key);
  playedOrder.push(key);
  if (playedOrder.length > MAX_TRACKED_KEYS) {
    const evicted = playedOrder.shift();
    if (evicted) playedKeys.delete(evicted);
  }
}

export function useEnterAnimation(
  enabled: boolean,
  animationKey?: string,
): (el: HTMLElement | null) => void {
  const enabledRef = useRef(enabled);
  const keyRef = useRef(animationKey);
  enabledRef.current = enabled;
  keyRef.current = animationKey;

  return useCallback((el: HTMLElement | null) => {
    if (!el || !enabledRef.current || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const key = keyRef.current;
    if (key && playedKeys.has(key)) return;

    el.animate(
      [
        { opacity: 0, transform: "translateY(0.375rem)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" },
    );

    if (key) {
      // In React StrictMode the first mount can be immediately torn down.
      // Only persist "played" once the element survives to the microtask tick.
      queueMicrotask(() => {
        if (el.isConnected) rememberPlayed(key);
      });
    }
  }, []);
}
