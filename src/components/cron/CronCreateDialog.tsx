/**
 * Create-job dialog.
 *
 * Minimal three-field form: schedule, prompt, name (optional).
 * Calls ``POST /api/dashboard/cron/jobs``.
 */

import { useEffect, useState } from "react";
import { X, Save, Loader } from "lucide-react";
import { useCreateJob } from "@/hooks/useCron";
import { errorMessage } from "@/lib/errors";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  /** Optional pre-filled values (e.g. from template CTA). */
  initialSchedule?: string;
  initialPrompt?: string;
  initialName?: string;
  labels: {
    title: string;
    schedule: string;
    schedHint: string;
    prompt: string;
    name: string;
    nameHint: string;
    save: string;
    saving: string;
    cancel: string;
    close: string;
  };
}

export default function CronCreateDialog({ open, onClose, onCreated, labels, initialSchedule, initialPrompt, initialName }: Props) {
  const [schedule, setSchedule] = useState(initialSchedule ?? "every 30m");
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [name, setName] = useState(initialName ?? "");
  const [err, setErr] = useState<string | null>(null);
  const create = useCreateJob();

  useEffect(() => {
    if (open) {
      setSchedule(initialSchedule ?? "every 30m");
      setPrompt(initialPrompt ?? "");
      setName(initialName ?? "");
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSave = async () => {
    setErr(null);
    if (!schedule.trim() || !prompt.trim()) {
      setErr("schedule and prompt required");
      return;
    }
    try {
      const job = await create.mutateAsync({
        schedule: schedule.trim(),
        prompt: prompt.trim(),
        name: name.trim() || undefined,
      });
      onCreated(job.id);
      onClose();
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
          <h3 style={{ margin: 0, fontSize: 'var(--hms-text-base)', fontWeight: 600 }}>{labels.title}</h3>
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
          <Field label={labels.schedule}>
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="every 30m / 0 9 * * * / at 2026-05-20 14:00"
              style={inputStyle}
              spellCheck={false}
              autoFocus
            />
            <Hint>{labels.schedHint}</Hint>
          </Field>

          <Field label={labels.prompt}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
              spellCheck={false}
            />
          </Field>

          <Field label={labels.name}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              spellCheck={false}
            />
            <Hint>{labels.nameHint}</Hint>
          </Field>

          {err && (
            <div className="hms-settings-notice hms-settings-notice--error">
              {err}
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
          <button onClick={onClose} style={cancelBtn}>
            {labels.cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={create.isPending}
            style={primaryBtn}
          >
            {create.isPending ? <Loader size={12} className="hms-spin" /> : <Save size={12} />}
            {create.isPending ? labels.saving : labels.save}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
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
        {label}
      </div>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.625rem', color: "var(--hms-text-muted)", marginTop: 4 }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 'var(--hms-text-caption)',
  background: "var(--hms-bg)",
  border: "1px solid var(--hms-border)",
  borderRadius: 6,
  color: "var(--hms-text)",
  outline: "none",
};

const primaryBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 'var(--hms-space-1)',
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid var(--hms-text)",
  background: "var(--hms-text)",
  color: "var(--hms-bg)",
  cursor: "pointer",
  fontSize: 'var(--hms-text-caption)',
  fontWeight: 600,
};

const cancelBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid var(--hms-border)",
  background: "transparent",
  color: "var(--hms-text)",
  cursor: "pointer",
  fontSize: 'var(--hms-text-caption)',
};
