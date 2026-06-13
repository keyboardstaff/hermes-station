import { Loader2 } from "lucide-react";

/**
 * Shared loading state — a centered braille-less spinner with optional caption.
 * Replaces the scattered bespoke "Loading…" text / ad-hoc spinners so every
 * surface reads the same while data resolves.
 */
export default function LoadingState({ label }: { label?: string }) {
  return (
    <div className="hms-loading-state">
      <Loader2 size={18} className="hms-spin" />
      {label && <span>{label}</span>}
    </div>
  );
}
