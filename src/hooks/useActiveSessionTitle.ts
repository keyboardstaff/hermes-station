import { useQuery } from "@tanstack/react-query";
import { useChatStore } from "@/store/chat";
import type { SessionSummary } from "@/lib/hermes-types";

/** Single source of truth for the active session's title.
 *
 *  Derives from the shared `sessions-table-all` react-query cache (the same
 *  one SessionRecents / SidebarRecents / SessionsPanel use) keyed by
 *  activeSessionId — so there's no separate, drift-prone copy in the store.
 *  Returns the raw title (or undefined); callers run it through
 *  `formatSessionTitle` for the display fallback.
 *
 *  Config mirrors SessionRecents' query so this observer shares the cache and
 *  stays self-sufficient even on a route where SessionRecents isn't mounted. */
export function useActiveSessionTitle(): string | undefined {
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const { data } = useQuery<{ sessions: SessionSummary[] }>({
    queryKey: ["sessions-table-all"],
    queryFn: async () => {
      const res = await fetch("/api/sessions?limit=1000");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    retry: false,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    refetchInterval: 30_000,
  });
  if (!activeSessionId) return undefined;
  return data?.sessions.find((s) => s.session_id === activeSessionId)?.title;
}
