import { useState, useRef, useEffect } from "react";
import { MoreHorizontal } from "lucide-react";
import { useI18n } from "@/i18n";
import IconButton from "@/components/ui/IconButton";
import { buildSessionActions, type SessionActionHandlers } from "@/lib/session-actions";

/**
 * SessionActionsMenu — the ··· dropdown surface for per-session actions.
 *
 * Shares its item spec with the SessionRecents right-click context menu via
 * `buildSessionActions` (single source). Owns its own open state, outside-click
 * close, and an inline Rename dialog so the caller only wires handlers.
 */
export interface SessionActionsMenuProps
  extends Omit<SessionActionHandlers, "onRename" | "onCopyId"> {
  sessionId: string;
  /** Current title — seeds the Rename dialog. */
  title: string;
  /** Persist a new title. */
  onRenameSubmit: (next: string) => void;
}

export default function SessionActionsMenu({
  sessionId,
  title,
  onRenameSubmit,
  ...handlers
}: SessionActionsMenuProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const items = buildSessionActions(t, {
    ...handlers,
    onRename: () => {
      setOpen(false);
      setRenameOpen(true);
    },
    onCopyId: () => {
      setOpen(false);
      void navigator.clipboard?.writeText(sessionId);
    },
  });

  return (
    <div style={{ position: "relative" }} ref={menuRef}>
      <IconButton
        active={open}
        onClick={() => setOpen((o) => !o)}
        aria-label={t.nav.exportSession}
        aria-expanded={open}
      >
        <MoreHorizontal size={16} />
      </IconButton>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 9999,
            background: "var(--hms-surface)",
            border: "1px solid var(--hms-border)",
            borderRadius: 8,
            padding: "4px 0",
            minWidth: 180,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--hms-space-2)",
                width: "100%",
                padding: "8px 14px",
                border: "none",
                background: "none",
                color: item.danger ? "var(--hms-error, #e53e3e)" : "var(--hms-text)",
                fontSize: "var(--hms-text-sm)",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--hms-surface-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "none";
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {renameOpen && (
        <RenameDialog
          initial={title}
          onCancel={() => setRenameOpen(false)}
          onSubmit={(next) => {
            setRenameOpen(false);
            onRenameSubmit(next);
          }}
        />
      )}
    </div>
  );
}

function RenameDialog({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: string;
  onCancel: () => void;
  onSubmit: (next: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const next = value.trim();
    if (next && next !== initial.trim()) onSubmit(next);
    else onCancel();
  };

  return (
    <div
      onMouseDown={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.32)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          background: "var(--hms-surface)",
          border: "1px solid var(--hms-border)",
          borderRadius: 12,
          padding: "var(--hms-space-4)",
          minWidth: 320,
          maxWidth: 420,
          boxShadow: "0 8px 32px rgba(0,0,0,0.24)",
        }}
      >
        <div style={{ fontSize: "var(--hms-text-sm)", fontWeight: 600, color: "var(--hms-text)" }}>
          {t.nav.renameSession}
        </div>
        <input
          ref={inputRef}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
          style={{
            width: "100%",
            marginTop: "var(--hms-space-3)",
            padding: "8px 10px",
            background: "var(--hms-bg)",
            border: "1px solid var(--hms-border)",
            borderRadius: 8,
            color: "var(--hms-text)",
            fontSize: "var(--hms-text-sm)",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--hms-space-2)",
            marginTop: "var(--hms-space-4)",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1px solid var(--hms-border)",
              borderRadius: 8,
              color: "var(--hms-text-muted)",
              fontSize: "var(--hms-text-sm)",
              cursor: "pointer",
            }}
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={submit}
            style={{
              padding: "6px 14px",
              background: "var(--hms-accent)",
              border: "1px solid var(--hms-accent)",
              borderRadius: 8,
              color: "var(--hms-on-accent, #fff)",
              fontSize: "var(--hms-text-sm)",
              cursor: "pointer",
            }}
          >
            {t.common.save}
          </button>
        </div>
      </div>
    </div>
  );
}
