import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Minimal modal dialog — backdrop + centered card + close button.
 *
 * Closes on Escape, on backdrop click, or via the X. The caller owns
 * the form/content; this component only handles chrome and focus
 * containment. Intentionally not a portal — fixed-position over
 * everything is good enough for station's single-window layout.
 */

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional footer slot — typically primary / cancel buttons. */
  footer?: React.ReactNode;
  /** Max width in px (defaults to 480). */
  maxWidth?: number;
}

export default function Dialog({ open, title, onClose, children, footer, maxWidth = 480 }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth,
          maxHeight: "85vh",
          background: "var(--hms-surface)",
          border: "1px solid var(--hms-border)",
          borderRadius: "0.75rem",
          boxShadow: "0 1.25rem 2.5rem rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.875rem 1rem",
            borderBottom: "1px solid var(--hms-border)",
            fontWeight: 600,
          }}
        >
          <span>{title}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "1.5rem",
              height: "1.5rem",
              border: "none",
              background: "transparent",
              color: "var(--hms-text-muted)",
              cursor: "pointer",
              borderRadius: "0.25rem",
            }}
          >
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: "1rem", overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: "0.5rem",
              padding: "0.75rem 1rem",
              borderTop: "1px solid var(--hms-border)",
              background: "var(--hms-bg)",
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
