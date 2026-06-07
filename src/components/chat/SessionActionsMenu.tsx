import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { useI18n } from "@/i18n";
import { buildSessionActions, type SessionActionHandlers } from "@/lib/session-actions";
import Button from "@/components/ui/Button";

/**
 * SessionActionsMenu — the session title doubles as the ··· trigger.
 *
 * Clicking the title opens a dropdown of per-session actions, sharing its item
 * spec with the SessionRecents right-click menu via `buildSessionActions`
 * (single source). The popover is `position: fixed` (anchored to the title
 * button's rect) so it escapes the title bar's `overflow: hidden` clip. Owns
 * its open state, outside-click close, and an inline Rename dialog.
 */
export interface SessionActionsMenuProps
  extends Omit<SessionActionHandlers, "onRename" | "onCopyId"> {
  sessionId: string;
  /** The session title — rendered as the clickable trigger + seeds Rename. */
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
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = () => {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen((o) => !o);
  };

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
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title={title}
        className="hms-sidebar-row hms-session-actions-trigger"
        data-active={open}
        style={{
          margin: 0,
        }}
      >
        <span className="hms-session-actions-trigger-label">
          {title}
        </span>
        <ChevronDown size={14} className="hms-session-actions-trigger-icon" />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="hms-session-actions-panel"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
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
              className="hms-sidebar-row hms-session-actions-item"
              style={{
                color: item.danger ? "var(--hms-error-text)" : "var(--hms-text)",
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
    </>
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
      className="hms-session-actions-dialog-backdrop"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="hms-session-actions-dialog"
      >
        <div className="hms-session-actions-dialog-title">
          {t.nav.renameSession}
        </div>
        <input
          ref={inputRef}
          className="hms-session-actions-dialog-input"
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
        />
        <div className="hms-session-actions-dialog-actions">
          <Button type="button" size="sm" onClick={onCancel}>
            {t.common.cancel}
          </Button>
          <Button type="button" size="sm" variant="primary" onClick={submit}>
            {t.common.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
