import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Server is the source of truth (owner-level, syncs across browsers/devices);
// localStorage is only a fast-start cache so the first paint doesn't flash an
// empty pin set before GET /api/preferences/pinned resolves.
const STORAGE_KEY = "hms:pinned-sessions";
const QUERY_KEY = ["pinned-sessions"] as const;

function readCache(): string[] {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) return JSON.parse(v) as string[];
  } catch {
    // private browsing or unavailable
  }
  return [];
}

function writeCache(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // private browsing or unavailable
  }
}

async function fetchPinned(): Promise<string[]> {
  const json = await api.get<{ pinned?: string[] }>("/api/preferences/pinned");
  const ids = Array.isArray(json.pinned) ? json.pinned : [];
  writeCache(ids); // keep the fast-start cache in step with server truth
  return ids;
}

async function persistPinned(ids: string[]): Promise<string[]> {
  const json = await api.json<{ pinned?: string[] }>("/api/preferences/pinned", "PUT", { pinned: ids });
  return Array.isArray(json.pinned) ? json.pinned : ids;
}

/**
 * Owner-level pinned session ids, persisted server-side so they follow the
 * owner across browsers/devices. Returns the current pinned set and a toggle.
 *
 * The localStorage cache feeds an instant first paint via `placeholderData`;
 * the GET then confirms against the server. `toggle` is an optimistic mutation
 * (cancel in-flight reads → patch cache + cache-file → PUT → reconcile/rollback)
 * so the UI never drifts from what's actually stored.
 */
export function usePinnedSessions() {
  const queryClient = useQueryClient();

  const { data } = useQuery<string[]>({
    queryKey: QUERY_KEY,
    queryFn: fetchPinned,
    placeholderData: readCache,
    staleTime: 30_000,
  });

  const { mutate } = useMutation<string[], Error, string[], { prev: string[] }>({
    mutationFn: persistPinned,
    onMutate: async (next) => {
      // Stop an in-flight GET from clobbering the optimistic value.
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const prev = queryClient.getQueryData<string[]>(QUERY_KEY) ?? readCache();
      queryClient.setQueryData<string[]>(QUERY_KEY, next);
      writeCache(next);
      return { prev };
    },
    onError: (_err, _next, ctx) => {
      // Persist failed → roll the UI back to what was stored before.
      if (ctx?.prev) {
        queryClient.setQueryData<string[]>(QUERY_KEY, ctx.prev);
        writeCache(ctx.prev);
      }
    },
    onSuccess: (server) => {
      queryClient.setQueryData<string[]>(QUERY_KEY, server);
      writeCache(server);
    },
  });

  const pinnedIds = new Set(data ?? []);

  const toggle = useCallback(
    (id: string) => {
      const current = queryClient.getQueryData<string[]>(QUERY_KEY) ?? readCache();
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      mutate(next);
    },
    [queryClient, mutate],
  );

  return { pinnedIds, toggle };
}
