import { useEffect, useRef, useState, type DependencyList } from "react";

/** Returns a debounced version of `value` delayed by `delay` ms. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, delay]);

  return debounced;
}

/**
 * Fire ``fn`` ``delay`` ms after the last change to ``deps`` settles.
 *
 * Equivalent to ``useEffect(() => { setTimeout(fn, delay); ... }, deps)``
 * but with the cleanup boilerplate centralised. Used by Security tab
 * (auto-save), Composer (search), SessionsFilters (search).
 */
export function useDebouncedEffect(
  fn: () => void,
  deps: DependencyList,
  delay: number,
): void {
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (ref.current) clearTimeout(ref.current);
    ref.current = setTimeout(fn, delay);
    return () => { if (ref.current) clearTimeout(ref.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
