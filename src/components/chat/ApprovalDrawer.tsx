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
 * Inline approval surface that sits between ChatStream and Composer. Unlike
 * the prior centred modal, this never covers the conversation — the user
 * can still scroll history or type a free-form reply.
 *
 * Choice semantics mirror upstream tools/approval.py:
 *   once    → allow this single invocation
 *   session → also remember pattern_key for this session (client-side, since
 *             the api_server platform's _session_approved set isn't reachable
 *             from outside the agent process)
 *   always  → also persist to ~/.hermes/config.yaml command_allowlist so the
 *             next gateway restart loads it into _permanent_approved
 *   deny    → dismiss without proceeding. We deliberately do NOT send a
 *             "do not run" follow-up: the agent's run has already terminated
 *             via the approval_required tool result; sending another message
 *             would just kick off a retry loop.
 */
export default function ApprovalDrawer({ payload, onProceed, onDeny, onDismiss }: ApprovalDrawerProps) {
  const { t } = useI18n();

  return (
    <div
      role="region"
      aria-label={t.approval.drawerTitle}
      className="hms-approval-drawer"
      style={{
        flexShrink: 0,
        margin: "0 16px",
        borderRadius: 10,
        border: "1px solid #f59e0b",
        background: "color-mix(in srgb, #f59e0b 8%, var(--hms-surface))",
        padding: "10px 12px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 'var(--hms-space-2)',
        boxShadow: "0 -4px 16px rgba(0,0,0,0.08)",
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
        <AlertTriangle size={14} style={{ color: "var(--hms-warning)", flexShrink: 0 }} />
        <span style={{ fontSize: 'var(--hms-text-caption)', fontWeight: 600 }}>
          {t.approval.drawerTitle}
        </span>
        {payload.patternKey && (
          <span
            style={{
              fontSize: '0.625rem',
              fontFamily: "monospace",
              padding: "1px 6px",
              borderRadius: 4,
              background: "rgba(245,158,11,0.15)",
              color: "var(--hms-warning-text)",
            }}
          >
            {payload.patternKey}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onDismiss}
          title={t.approval.dismiss}
          aria-label={t.approval.dismiss}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--hms-text-muted)",
            cursor: "pointer",
            display: "flex",
            padding: 2,
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Command */}
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          background: "var(--hms-bg)",
          border: "1px solid var(--hms-border)",
          borderRadius: 6,
          fontFamily: "'Fira Code', Consolas, monospace",
          fontSize: 'var(--hms-text-caption)',
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: 120,
          overflowY: "auto",
          color: "var(--hms-text)",
        }}
      >
        {payload.command || "(no command)"}
      </pre>

      {/* Description */}
      {payload.description && (
        <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", lineHeight: 1.5 }}>
          {payload.description}
        </div>
      )}

      {/* Actions: Deny | Once | Session | Always */}
      <div style={{ display: "flex", gap: 'var(--hms-space-2)', justifyContent: "flex-end", flexWrap: "wrap" }}>
        <DenyBtn label={t.approval.deny} onClick={onDeny} />
        <ProceedBtn
          label={t.approval.approveOnce}
          title={t.approval.onceHint}
          icon={<Check size={12} />}
          onClick={() => onProceed("once")}
          tone="default"
        />
        <ProceedBtn
          label={t.approval.approveSession}
          title={t.approval.sessionHint}
          icon={<Shield size={12} />}
          onClick={() => onProceed("session")}
          tone="default"
        />
        <ProceedBtn
          label={t.approval.approveAlways}
          title={t.approval.alwaysHint}
          icon={<ShieldCheck size={12} />}
          onClick={() => onProceed("always")}
          tone="strong"
        />
      </div>

      <div style={{ fontSize: '0.625rem', color: "var(--hms-text-muted)" }}>
        {t.approval.freeformHint}
      </div>
    </div>
  );
}

function DenyBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 'var(--hms-space-1)',
        padding: "5px 12px",
        borderRadius: 6,
        border: "1px solid var(--hms-border)",
        background: "var(--hms-bg)",
        color: "var(--hms-text)",
        fontSize: 'var(--hms-text-caption)',
        cursor: "pointer",
      }}
    >
      <X size={12} /> {label}
    </button>
  );
}

function ProceedBtn({
  label, title, icon, onClick, tone,
}: {
  label: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone: "default" | "strong";
}) {
  const isStrong = tone === "strong";
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 'var(--hms-space-1)',
        padding: "5px 12px",
        borderRadius: 6,
        border: isStrong ? "none" : "1px solid #f59e0b",
        background: isStrong ? "var(--hms-warning)" : "color-mix(in srgb, #f59e0b 15%, transparent)",
        color: isStrong ? "#0a0a0a" : "var(--hms-warning-text)",
        fontSize: 'var(--hms-text-caption)',
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {icon} {label}
    </button>
  );
}
