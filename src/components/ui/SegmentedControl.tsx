/**
 * Horizontal segmented control — one selected option among several. Replaces
 * the ad-hoc tab/segment rows in Logs filters, Settings/Profile tabs, etc.
 * Token-only; generic over the option value type.
 */
export default function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const pad = size === "sm" ? "2px 8px" : "4px 12px";
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        background: "var(--hms-hover-bg)",
        borderRadius: "var(--hms-radius-md)",
      }}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(o.value)}
            style={{
              padding: pad,
              border: "none",
              borderRadius: "var(--hms-radius-sm)",
              background: selected ? "var(--hms-bg)" : "transparent",
              color: selected ? "var(--hms-text)" : "var(--hms-text-muted)",
              fontWeight: selected ? 600 : 400,
              fontSize: "var(--hms-text-sm)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
