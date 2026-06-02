import { PopupSelect } from "@/components/ui/PopupSelect";

// Small composer toolbar building blocks, extracted from Composer.

export function PillSelect({
  icon,
  value,
  options,
  onChange,
  disabledHint,
  footerAction,
}: {
  icon: React.ReactNode;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  disabledHint?: string;
  footerAction?: { label: string; icon?: React.ReactNode; onClick: () => void };
}) {
  return (
    <PopupSelect
      icon={icon}
      label={value}
      options={options.map((o) => ({ value: o, label: o }))}
      value={value}
      onChange={onChange}
      disabledHint={disabledHint}
      footerAction={footerAction}
    />
  );
}

export function ToolbarBtn({ title, children, onClick }: { title: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        borderRadius: 6,
        border: "none",
        background: "transparent",
        color: "var(--hms-text-muted)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function sendStyle({ danger, disabled }: { danger?: boolean; disabled?: boolean }) {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "none",
    background: danger ? "var(--hms-error)" : disabled ? "var(--hms-border)" : "var(--hms-text)",
    color: disabled ? "var(--hms-text-muted)" : "var(--hms-bg)",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 0.15s",
  } as React.CSSProperties;
}
