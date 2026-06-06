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
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="hms-segmented"
      data-size={size}
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
            className="hms-segmented-item"
            data-active={selected}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
