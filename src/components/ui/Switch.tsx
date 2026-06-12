/** Toggle switch — the boolean control for enable/disable semantics (replaces
 *  bare checkboxes in Settings surfaces). Accent track when on. */
export default function Switch({
  checked, onChange, disabled, title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      className="hms-switch"
      data-on={checked ? "true" : undefined}
      onClick={() => onChange(!checked)}
    >
      <span className="hms-switch-knob" />
    </button>
  );
}
