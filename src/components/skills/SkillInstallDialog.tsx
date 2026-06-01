/**
 * Install-skill dialog.
 *
 * Accepts a free-form identifier (hub alias, git URL, HF id, etc.) and
 * proxies to ``POST /api/dashboard/agent-plugins/install``.
 */

import { useEffect, useState } from "react";
import { X, Download, Loader } from "lucide-react";
import Button from "@/components/ui/Button";
import { useInstallSkill } from "@/hooks/useSkills";
import { errorMessage } from "@/lib/errors";

interface Props {
  open: boolean;
  onClose: () => void;
  labels: {
    title: string;
    identifierLabel: string;
    identifierHint: string;
    install: string;
    installing: string;
    cancel: string;
    close: string;
    enable: string;
    force: string;
    installSuccess: string;
  };
}

export default function SkillInstallDialog({ open, onClose, labels }: Props) {
  const install = useInstallSkill();
  const [identifier, setIdentifier] = useState("");
  const [enable, setEnable] = useState(true);
  const [force, setForce] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setIdentifier("");
      setEnable(true);
      setForce(false);
      setErr(null);
      setSuccess(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleInstall = async () => {
    setErr(null);
    setSuccess(null);
    if (!identifier.trim()) {
      setErr("identifier required");
      return;
    }
    try {
      const r = await install.mutateAsync({
        identifier: identifier.trim(),
        enable,
        force,
      });
      if (r.ok) {
        setSuccess(`${labels.installSuccess} ${r.name ?? identifier}`);
        setIdentifier("");
      } else {
        setErr(r.error || "Install failed");
      }
    } catch (e: unknown) {
      setErr(errorMessage(e));
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 'var(--hms-space-4)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--hms-surface)",
          border: "1px solid var(--hms-border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 16px",
            borderBottom: "1px solid var(--hms-border)",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 'var(--hms-text-base)', fontWeight: 600 }}>
            {labels.title}
          </h3>
          <button
            onClick={onClose}
            aria-label={labels.close}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: "var(--hms-text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 'var(--hms-space-4)', display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)' }}>
          <div>
            <div
              style={{
                fontSize: '0.625rem',
                fontWeight: 600,
                color: "var(--hms-text-muted)",
                marginBottom: 4,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {labels.identifierLabel}
            </div>
            <input
              type="text"
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="my-skill / git+https://... / hf:user/repo"
              style={{
                width: "100%",
                padding: "6px 10px",
                fontSize: 'var(--hms-text-caption)',
                background: "var(--hms-bg)",
                border: "1px solid var(--hms-border)",
                borderRadius: 6,
                color: "var(--hms-text)",
                outline: "none",
                fontFamily: "monospace",
                boxSizing: "border-box",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleInstall();
                }
              }}
            />
            <div style={{ fontSize: '0.625rem', color: "var(--hms-text-muted)", marginTop: 4 }}>
              {labels.identifierHint}
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', fontSize: 'var(--hms-text-caption)'}}>
            <input
              type="checkbox"
              checked={enable}
              onChange={(e) => setEnable(e.target.checked)}
            />
            {labels.enable}
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', fontSize: 'var(--hms-text-caption)'}}>
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            {labels.force}
          </label>

          {err && (
            <div
              style={{
                padding: "6px 10px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.18)",
                borderRadius: 6,
                color: "var(--hms-error-text)",
                fontSize: 'var(--hms-text-caption)',
              }}
            >
              {err}
            </div>
          )}

          {success && (
            <div
              style={{
                padding: "6px 10px",
                background: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.20)",
                borderRadius: 6,
                color: "var(--hms-success-text)",
                fontSize: 'var(--hms-text-caption)',
              }}
            >
              ✓ {success}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 'var(--hms-space-2)',
            padding: "12px 16px",
            borderTop: "1px solid var(--hms-border)",
          }}
        >
          <Button size="sm" onClick={onClose}>{labels.cancel}</Button>
          <Button size="sm" variant="primary" onClick={handleInstall} disabled={install.isPending}>
            {install.isPending ? <Loader size={12} className="hms-spin" /> : <Download size={12} />}
            {install.isPending ? labels.installing : labels.install}
          </Button>
        </div>
      </div>
    </div>
  );
}
