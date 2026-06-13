import { AlertTriangle, Check, ShieldCheck, Shield, X } from "lucide-react";
import { useI18n } from "@/i18n";
import type { ApprovalPayload } from "@/lib/hermes-types";

export type ApprovalChoice = "once" | "session" | "always";

interface ApprovalDrawerProps {
  payload: ApprovalPayload;
  onProceed: (choice: ApprovalChoice) => void;
  onDeny: () => void;
  onDismiss: () => void;
}

/**
 * Inline approval surface between ChatStream and Composer. Never covers the
 * conversation — the user can still scroll history or type a reply. All colors
 * come from the warning tokens (theme/skin-aware), not hardcoded amber.
 *
 * Choice semantics mirror upstream tools/approval.py:
 *   once    → allow this single invocation
 *   session → remember pattern_key for this session
 *   always  → also persist to config.yaml command_allowlist
 *   deny    → dismiss without proceeding (no "do not run" follow-up — the run
 *             already terminated via the approval_required tool result).
 */
export default function ApprovalDrawer({ payload, onProceed, onDeny, onDismiss }: ApprovalDrawerProps) {
  const { t } = useI18n();

  return (
    <div role="region" aria-label={t.approval.drawerTitle} className="hms-approval-drawer">
      <div className="hms-approval-head">
        <AlertTriangle size={14} className="hms-approval-warn-icon" />
        <span className="hms-approval-title">{t.approval.drawerTitle}</span>
        {payload.patternKey && <span className="hms-approval-pattern">{payload.patternKey}</span>}
        <div className="hms-approval-spacer" />
        <button
          type="button"
          onClick={onDismiss}
          title={t.approval.dismiss}
          aria-label={t.approval.dismiss}
          className="hms-approval-dismiss"
        >
          <X size={13} />
        </button>
      </div>

      <pre className="hms-approval-command">{payload.command || "(no command)"}</pre>

      {payload.description && <div className="hms-approval-desc">{payload.description}</div>}

      <div className="hms-approval-actions">
        <button type="button" className="hms-approval-btn" onClick={onDeny}>
          <X size={12} /> {t.approval.deny}
        </button>
        <button type="button" className="hms-approval-btn" title={t.approval.onceHint} onClick={() => onProceed("once")}>
          <Check size={12} /> {t.approval.approveOnce}
        </button>
        <button type="button" className="hms-approval-btn" title={t.approval.sessionHint} onClick={() => onProceed("session")}>
          <Shield size={12} /> {t.approval.approveSession}
        </button>
        <button type="button" className="hms-approval-btn" data-strong title={t.approval.alwaysHint} onClick={() => onProceed("always")}>
          <ShieldCheck size={12} /> {t.approval.approveAlways}
        </button>
      </div>

      <div className="hms-approval-freeform">{t.approval.freeformHint}</div>
    </div>
  );
}
