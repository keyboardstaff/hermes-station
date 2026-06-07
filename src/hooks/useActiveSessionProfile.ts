import { useQuery } from "@tanstack/react-query";
import { useChatStore } from "@/store/chat";
import type { SessionSummary } from "@/lib/hermes-types";

/** The owning profile of the active chat session (from the shared
 *  `sessions-table-all` cache), or undefined for none / an untagged (default)
 *  session. Lets the Composer profile pill reflect which profile the open chat
 *  runs in — e.g. while browsing in the "All profiles" scope, opening a session
 *  of profile X shows X on the pill (the run already targets X). */
export function useActiveSessionProfile(): string | undefined {
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
  });
  if (!activeSessionId) return undefined;
  return data?.sessions.find((s) => s.session_id === activeSessionId)?.profile;
}
