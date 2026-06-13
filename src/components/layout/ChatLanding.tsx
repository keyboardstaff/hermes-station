import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useChatStore } from "@/store/chat";
import type { SessionSummary } from "@/lib/hermes-types";

/**
 * Index landing ("/"): open the most recent conversation in /chat (the default
 * destination), or the empty /chat intro when there are no sessions yet. Uses
 * the shared `sessions-table-all` cache so it doesn't add a request when the
 * sidebar already loaded it.
 */
export default function ChatLanding() {
  const navigate = useNavigate();
  const setActiveSession = useChatStore((s) => s.setActiveSession);

  const { data, isLoading, isError } = useQuery<{ sessions: SessionSummary[] }>({
    queryKey: ["sessions-table-all"],
    queryFn: async () => {
      const res = await fetch("/api/sessions?limit=1000");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    retry: 1,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (isLoading) return;
    const sessions = data?.sessions ?? [];
    if (!isError && sessions.length > 0) {
      const latest = [...sessions].sort(
        (a, b) => (b.updated_at ?? b.started_at ?? 0) - (a.updated_at ?? a.started_at ?? 0),
      )[0];
      setActiveSession(latest.session_id);
    } else {
      setActiveSession(null);
    }
    navigate("/chat", { replace: true });
  }, [isLoading, isError, data, setActiveSession, navigate]);

  return null;
}
