import { useState, useCallback } from "react";

const STORAGE_KEY = "hms:pinned-sessions";

function readPinned(): Set<string> {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) return new Set<string>(JSON.parse(v) as string[]);
  } catch {
    // private browsing or unavailable
  }
  return new Set();
}

function writePinned(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // private browsing or unavailable
  }
}

/**
 * Persists a set of pinned session IDs in localStorage.
 * Returns the current pinned set and a toggle function.
 */
export function usePinnedSessions() {
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(readPinned);

  const toggle = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writePinned(next);
      return next;
    });
  }, []);

  return { pinnedIds, toggle };
}
