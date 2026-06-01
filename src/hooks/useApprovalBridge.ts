import { useCallback, useEffect } from "react";
import { useWSStore } from "@/store/ws";
import { useChatStore } from "@/store/chat";
import type { ApprovalRequestedMessage, ClientMessage } from "@/lib/ws-types";

/** WS approval channel ↔ chat store. Subscribes to global "approval" so the drawer
 *  surfaces regardless of which run is viewed; resolveApproval wakes the same run. */
export type ApprovalChoice = "once" | "session" | "always" | "deny";

export function useApprovalBridge() {
  const subscribe = useWSStore((s) => s.subscribe);
  const unsubscribe = useWSStore((s) => s.unsubscribe);
  const on = useWSStore((s) => s.on);
  const send = useWSStore((s) => s.send);
  const connect = useWSStore((s) => s.connect);
  const setPendingApproval = useChatStore((s) => s.setPendingApproval);

  useEffect(() => {
    connect();
    subscribe("approval");
    return () => {
      unsubscribe("approval");
    };
  }, [connect, subscribe, unsubscribe]);

  useEffect(() => {
    const off = on<ApprovalRequestedMessage>("approval.requested", (msg) => {
      // session_key === session_id in our backend (server/runs.py + server/approvals.py).
      setPendingApproval({
        sessionId: msg.session_key,
        payload: {
          // toolCallId is unused for the bridge flow; kept for legacy NLP surface.
          toolCallId: `bridge:${msg.run_id}`,
          command: msg.command,
          description: msg.description,
          patternKey: msg.pattern_key,
        },
      });
    });
    return off;
  }, [on, setPendingApproval]);

  /** Stale session_key resolves to resolved:0 server-side — harmless. */
  const resolveApproval = useCallback(
    (sessionKey: string, runId: string | null, choice: ApprovalChoice) => {
      const msg: ClientMessage = {
        type: "approval.resolve",
        run_id: runId ?? "",
        choice,
      };
      // Server accepts session_key alongside the typed shape; cast so we don't widen the union.
      send({ ...msg, session_key: sessionKey } as ClientMessage);
      // Clear immediately so the user can't double-click.
      setPendingApproval(null);
    },
    [send, setPendingApproval]
  );

  return { resolveApproval };
}
