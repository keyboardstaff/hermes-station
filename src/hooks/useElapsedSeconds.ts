import { useEffect, useRef, useState } from "react";

// Module-level registry so timers survive component unmount/remount (e.g. a
// tool row scrolling out and back, or a branch switch re-rendering the turn).
// Keyed by caller-supplied timerKey; anonymous timers start fresh each mount.
// Ported from upstream desktop's activity-timer.
const startedAtByKey = new Map<string, number>();

function startedAt(key?: string, explicitStart?: number): number {
  if (!key) return explicitStart ?? Date.now();
  const existing = startedAtByKey.get(key);
  if (existing !== undefined) return existing;
  const now = explicitStart ?? Date.now();
  startedAtByKey.set(key, now);
  return now;
}

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Live elapsed seconds while `active`. `explicitStart` (epoch ms — e.g. the
 *  server's run started_at) wins over the registry so a refresh resumes from
 *  the real start instead of restarting at 0. */
export function useElapsedSeconds(active = true, timerKey?: string, explicitStart?: number): number {
  const start = useRef(explicitStart ?? startedAt(timerKey));
  const lastKey = useRef(timerKey);
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - start.current) / 1000)),
  );

  if (lastKey.current !== timerKey) {
    start.current = explicitStart ?? startedAt(timerKey);
    lastKey.current = timerKey;
  }

  useEffect(() => {
    if (!active) return;
    start.current = explicitStart ?? startedAt(timerKey);
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start.current) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, timerKey, explicitStart]);

  return elapsed;
}
