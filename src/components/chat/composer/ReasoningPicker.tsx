import { Brain } from "lucide-react";
import { PopupSelect } from "@/components/ui/PopupSelect";

// Reasoning-effort picker, extracted from Composer.
// Values match upstream hermes_constants.VALID_REASONING_EFFORTS.
// null = omit field → upstream uses config.yaml default. NEVER send "auto" — invalid.

interface ReasoningOption {
  value: string | null;
  label: string;
}

const REASONING_OPTIONS: ReasoningOption[] = [
  { value: "none",    label: "None" },
  { value: null,      label: "Default" },
  { value: "minimal", label: "Minimal" },
  { value: "low",     label: "Low" },
  { value: "medium",  label: "Medium" },
  { value: "high",    label: "High" },
  { value: "xhigh",   label: "Extra High" },
];

function reasoningLabel(value: string | null): string {
  const opt = REASONING_OPTIONS.find((o) => o.value === value);
  return opt?.label ?? "Default";
}

export function ReasoningPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <PopupSelect<string | null>
      icon={<Brain size={12} style={{ flexShrink: 0 }} />}
      label={reasoningLabel(value)}
      options={REASONING_OPTIONS}
      value={value}
      onChange={onChange}
      muted={value === null}
    />
  );
}
