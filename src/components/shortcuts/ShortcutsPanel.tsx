import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";

interface ShortcutsPanelProps {
  onClose: () => void;
}

const isMac = navigator.platform.includes("Mac");
const mod = isMac ? "⌘" : "Ctrl";

export default function ShortcutsPanel({ onClose }: ShortcutsPanelProps) {
  const { t } = useI18n();
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      onClose();
    }, 200);
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, [requestClose]);

  const shortcuts: [string, string[]][] = [
    [t.shortcuts.globalSearch, [mod, "K"]],
    [t.shortcuts.newSession, isMac ? ["⌃", "⌘", "N"] : ["Ctrl", "Shift", "N"]],
    [t.shortcuts.sendMessage, ["Enter"]],
    [t.shortcuts.newLine, ["Shift", "Enter"]],
    [t.shortcuts.slashCommand, ["/"]],
    [t.shortcuts.stopGeneration, ["Escape"]],
    [t.shortcuts.closePanel, ["Escape"]],
    ["Delete session (hold Shift, click session)", ["Shift", "Click"]],
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={requestClose}
        className={closing ? "animate-fadeOut" : "animate-fadeIn"}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 98,
        }}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-label={t.shortcuts.title}
        className={closing ? "animate-slideDown" : "animate-slideUp"}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 400,
          background: "var(--hms-surface)",
          border: "1px solid var(--hms-border)",
          borderRadius: 12,
          padding: 20,
          zIndex: 99,
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--hms-text-md)', fontWeight: 600 }}>
            {t.shortcuts.title}
          </h2>
          <button
            onClick={requestClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 'var(--hms-text-lg)',
              color: "var(--hms-text-muted)",
            }}
          >
            ×
          </button>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {shortcuts.map(([action, key]) => (
              <tr key={action}>
                <td style={{ padding: "6px 0", fontSize: 'var(--hms-text-sm)', color: "var(--hms-text)" }}>
                  {action}
                </td>
                <td style={{ padding: "6px 0", textAlign: "right" }}>
                  <span style={{ display: "inline-flex", gap: 'var(--hms-space-1)', alignItems: "center" }}>
                    {key.map((k, i) => (
                      <kbd
                        key={i}
                        style={{
                          padding: "2px 6px",
                          borderRadius: 4,
                          border: "1px solid var(--hms-border)",
                          background: "var(--hms-bg)",
                          fontSize: 'var(--hms-text-caption)',
                          fontFamily: "monospace",
                        }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
