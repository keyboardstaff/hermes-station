import { useCallback } from "react";
import { useChatStore } from "@/store/chat";

/**
 * Approval drawer visibility gate.
 *
 * After the source of approval state moved to
 * the WebSocket "approval.requested" frame (see useApprovalBridge),
 * this hook only handles which session
 * the drawer should render in: switching tabs hides it, switching
 * back surfaces it again. An earlier implementation also tried
 * to parse "approval_required" out of legacy tool-result JSON and
 * fake a "Please proceed" user follow-up; that NLP shim is gone now.
 */
export function useDangerousCommandApproval() {
  const pending = useChatStore((s) => s.pendingApproval);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setPending = useChatStore((s) => s.setPendingApproval);

  const clear = useCallback(() => setPending(null), [setPending]);

  const visible =
    pending && pending.sessionId === activeSessionId ? pending.payload : null;

  return { pending: visible, clear };
}
