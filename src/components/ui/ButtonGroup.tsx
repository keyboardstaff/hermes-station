/**
 * Vertical button group used in SidePanel filters.
 *
 * Both ``LogsFilters`` and ``SessionsFilters`` re-implemented this
 * pattern by hand. Extracting it keeps styling consistent and gives
 * future panels a one-import drop-in.
 */
import { type ReactNode } from "react";

export interface ButtonGroupOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Optional smaller secondary label rendered right-aligned. */
  hint?: ReactNode;
}

export interface ButtonGroupProps<T extends string | number> {
  options: ButtonGroupOption<T>[];
  value: T;
  onChange: (v: T) => void;
  /** Compact mode tightens vertical padding for dense sidebars. */
  compact?: boolean;
  ariaLabel?: string;
}

export function ButtonGroup<T extends string | number>({
  options, value, onChange, compact, ariaLabel,
}: ButtonGroupProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-1)' }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              width: "100%", textAlign: "left",
              padding: compact ? "4px 8px" : "5px 8px",
              borderRadius: 5,
              border: "none",
              background: active ? "var(--hms-border)" : "transparent",
              color: "var(--hms-text)",
              fontSize: 'var(--hms-text-caption)',
              cursor: "pointer",
              fontWeight: active ? 600 : 400,
            }}
          >
            <span>{opt.label}</span>
            {opt.hint && <span style={{ fontSize: '0.625rem', color: "var(--hms-text-muted)" }}>{opt.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
