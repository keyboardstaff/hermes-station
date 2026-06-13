import type { ReactNode } from "react";

/**
 * Shared empty state — a centered icon + title (+ optional hint), so the
 * "nothing here yet" surfaces share one calm, on-brand look instead of each
 * panel rolling its own.
 */
export default function EmptyState({
  icon, title, hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="hms-empty-state">
      {icon && <span className="hms-empty-state-icon">{icon}</span>}
      <p className="hms-empty-state-title">{title}</p>
      {hint && <p className="hms-empty-state-hint">{hint}</p>}
    </div>
  );
}
