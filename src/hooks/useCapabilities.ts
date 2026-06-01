/**
 * Thin wrapper around `useCapabilityStore` for consistent hook-style access.
 *
 * Previously this hook had its own react-query fetch + WS subscription
 * that duplicated the Zustand store's polling. It is now a simple derived
 * accessor so there is only one source of truth.
 *
 * Use `useCapabilityStore()` directly when you need `reprobe()` or the full
 * `CapabilityResult`; use `useCapabilities()` when you only need flags.
 */
import { useCapabilityStore, type CapabilityFlags } from "@/store/capabilities";

/** Legacy alias so callers using the old `Flags` type name still compile. */
export type Flags = CapabilityFlags;

export function useCapabilities() {
  const { caps, loading, fetch } = useCapabilityStore();
  const flags = caps?.flags ?? ({} as CapabilityFlags);
  return { flags, isLoading: loading, refetch: fetch };
}
