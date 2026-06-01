/**
 * modal dialog for editing a single API key.
 *
 * Writes via ``PUT /api/models/keys`` (proxies to upstream
 * ``PUT /api/env``). Mounted when the user clicks an Edit button in
 * the Keys tab.
 */

import { useEffect, useRef, useState } from "react";
import { X, ExternalLink, Save } from "lucide-react";
import Button from "@/components/ui/Button";
import { useSetKey } from "@/hooks/useProviders";
import { errorMessage } from "@/lib/errors";

interface Props {
  open: boolean;
  onClose: () => void;
  name: string;
  /** Pre-filled value if revealed; otherwise blank. */
  initialValue?: string;
  description?: string;
  url?: string | null;
  labels: {
    title: string;
    valueLabel: string;
    valuePlaceholder: string;
    save: string;
    saving: string;
    cancel: string;
    getKeyAt: string;
    close: string;
  };
}

export default function KeyEditDialog({
  open,
  onClose,
  name,
  initialValue = "",
  description,
  url,
  labels,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const setKey = useSetKey();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSave = async () => {
    setError(null);
    try {
      await setKey.mutateAsync({ name, value });
      onClose();
    } catch (e: unknown) {
      setError(errorMessage(e));
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
          boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
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
            {labels.title}: <code style={{ fontSize: 'var(--hms-text-sm)'}}>{name}</code>
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

        {/* Body */}
        <div style={{ padding: 'var(--hms-space-4)' }}>
          {description && (
            <p
              style={{
                margin: "0 0 10px",
                fontSize: 'var(--hms-text-caption)',
                color: "var(--hms-text-muted)",
                lineHeight: 1.5,
              }}
            >
              {description}
            </p>
          )}

          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 'var(--hms-space-1)',
                marginBottom: 14,
                fontSize: 'var(--hms-text-xs)',
                color: "var(--hms-accent)",
                textDecoration: "none",
              }}
            >
              {labels.getKeyAt}
              <ExternalLink size={11} />
            </a>
          )}

          <label
            style={{
              display: "block",
              fontSize: 'var(--hms-text-xs)',
              fontWeight: 600,
              color: "var(--hms-text-muted)",
              marginBottom: 4,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {labels.valueLabel}
          </label>
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleSave();
              }
            }}
            placeholder={labels.valuePlaceholder}
            style={{
              width: "100%",
              padding: "8px 10px",
              fontFamily: "monospace",
              fontSize: 'var(--hms-text-caption)',
              background: "var(--hms-bg)",
              border: "1px solid var(--hms-border)",
              borderRadius: 6,
              color: "var(--hms-text)",
              outline: "none",
            }}
          />

          {error && (
            <div
              style={{
                marginTop: 10,
                padding: "6px 10px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.18)",
                borderRadius: 6,
                color: "var(--hms-error-text)",
                fontSize: 'var(--hms-text-caption)',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
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
          <Button size="sm" variant="primary" onClick={handleSave} disabled={setKey.isPending}>
            <Save size={12} />
            {setKey.isPending ? labels.saving : labels.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
