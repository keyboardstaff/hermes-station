/**
 * PopupSelect — unified custom-popup dropdown component.
 *
 * Replaces native <select> elements across the UI with a consistent
 * floating-panel picker that matches the Composer toolbar style.
 *
 * Two visual modes controlled by `fullWidth`:
 *   false (default) — inline pill trigger, popup opens ABOVE (toolbar use)
 *   true            — full-width form-input trigger, popup opens BELOW (form use)
 */
import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

type SelectValue = string | null;

export interface PopupSelectOption<T extends SelectValue = string> {
  value: T;
  label: string;
}

export interface PopupSelectProps<T extends SelectValue = string> {
  /** Icon shown before the label in the trigger button. */
  icon?: React.ReactNode;
  /** Display label on the trigger (usually the selected option's label). */
  label: string;
  options: PopupSelectOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Optional footer action separated by a divider (e.g. "Manage profiles"). */
  footerAction?: { label: string; icon?: React.ReactNode; onClick: () => void };
  /** Renders a non-interactive greyed trigger showing this hint instead. */
  disabledHint?: string;
  /**
   * true  → full-width form-input style, popup opens below the trigger.
   * false → inline pill style, popup opens above the trigger.
   */
  fullWidth?: boolean;
  /** Width of the popup panel in px. Ignored when fullWidth=true (uses trigger width). */
  popupWidth?: number;
  /** Renders trigger label in muted color (e.g. when value represents "none/default"). */
  muted?: boolean;
  /** fullWidth only: drop the box (border/background/radius) so the trigger
   *  blends into its container like a plain header row. */
  plain?: boolean;
}

interface PosState {
  anchor: number; // top of trigger (above) or bottom of trigger (below)
  left: number;
  triggerWidth: number;
  above: boolean;
  maxH: number;  // available viewport height for the popup
}

export function PopupSelect<T extends SelectValue = string>({
  icon,
  label,
  options,
  value,
  onChange,
  footerAction,
  disabledHint,
  fullWidth = false,
  popupWidth = 160,
  muted = false,
  plain = false,
}: PopupSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PosState>({ anchor: 0, left: 0, triggerWidth: 0, above: true, maxH: 320 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = () => {
    if (!open) {
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) {
        const estH = Math.min(options.length * 32 + 8 + (footerAction ? 40 : 0), 320);
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const spaceAbove = rect.top - 8;
        // fullWidth (form): prefer below; pill (toolbar): prefer above
        const openBelow = fullWidth
          ? spaceBelow >= estH || spaceBelow >= spaceAbove
          : spaceAbove < estH && spaceBelow >= estH;
        setPos({
          anchor: openBelow ? rect.bottom : rect.top,
          left: rect.left,
          triggerWidth: rect.width,
          above: !openBelow,
          maxH: Math.max(openBelow ? spaceBelow : spaceAbove, 80),
        });
      }
    }
    setOpen((o) => !o);
  };

  const pillBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--hms-space-1)",
    padding: "2px 6px",
    borderRadius: 6,
    border: "1px solid var(--hms-border)",
    background: "var(--hms-surface)",
    fontSize: "var(--hms-text-caption)",
    cursor: disabledHint ? "not-allowed" : "pointer",
    userSelect: "none",
    opacity: disabledHint ? 0.45 : 1,
  };

  const fullWidthBase: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: plain ? "4px 2px" : "6px 10px",
    fontSize: plain ? "var(--hms-text-sm)" : "var(--hms-text-caption)",
    background: plain ? "transparent" : "var(--hms-bg)",
    border: plain ? "none" : "1px solid var(--hms-border)",
    borderRadius: plain ? 0 : 6,
    cursor: disabledHint ? "not-allowed" : "pointer",
    userSelect: "none",
    opacity: disabledHint ? 0.45 : 1,
    textAlign: "left",
  };

  const triggerStyle: React.CSSProperties = {
    ...(fullWidth ? fullWidthBase : pillBase),
    color: disabledHint || muted ? "var(--hms-text-muted)" : "var(--hms-text)",
  };

  const panelWidth = fullWidth ? pos.triggerWidth : popupWidth;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={disabledHint ? undefined : handleOpen}
        style={triggerStyle}
      >
        {icon && (
          <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
            {icon}
          </span>
        )}
        <span
          style={{
            flex: fullWidth ? 1 : undefined,
            maxWidth: fullWidth ? undefined : 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginLeft: fullWidth && icon ? "var(--hms-space-1)" : undefined,
          }}
        >
          {disabledHint ?? label}
        </span>
        <ChevronDown
          size={fullWidth ? 13 : 10}
          style={{
            color: "var(--hms-text-muted)",
            flexShrink: 0,
            marginLeft: fullWidth ? "auto" : undefined,
          }}
        />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="hms-popup-panel"
          style={{
            position: "fixed",
            ...(pos.above
              ? { bottom: `${window.innerHeight - pos.anchor + 6}px` }
              : { top: `${pos.anchor + 6}px` }),
            left: Math.min(pos.left, window.innerWidth - panelWidth - 8) + "px",
            width: panelWidth,
            background: "var(--hms-surface)",
            border: "1px solid var(--hms-border)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
            zIndex: 9999,
            padding: "4px 0",
            maxHeight: pos.maxH,
            overflowY: "auto",
          }}
        >
          {options.map((opt) => {
            const isSelected = value === opt.value;
            const baseBg = isSelected ? "var(--hms-border)" : "transparent";
            return (
              <div
                key={String(opt.value)}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: "var(--hms-text-caption)",
                  color: isSelected ? "var(--hms-text)" : "var(--hms-text-muted)",
                  background: baseBg,
                  transition: "background 120ms",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "var(--hms-border)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = baseBg;
                }}
              >
                <span>{opt.label}</span>
                {isSelected && (
                  <Check size={11} style={{ flexShrink: 0, color: "var(--hms-success)" }} />
                )}
              </div>
            );
          })}

          {footerAction && (
            <>
              <div style={{ borderTop: "1px solid var(--hms-border)", margin: "4px 0" }} />
              <div
                onClick={() => { footerAction.onClick(); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--hms-space-2)",
                  padding: "6px 12px",
                  cursor: "pointer",
                  fontSize: "var(--hms-text-caption)",
                  color: "var(--hms-text-muted)",
                  background: "transparent",
                  transition: "background 120ms",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "var(--hms-border)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
                }}
              >
                {footerAction.icon}
                <span>{footerAction.label}</span>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
