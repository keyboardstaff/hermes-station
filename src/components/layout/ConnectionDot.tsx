import { useCapabilityStore } from "@/store/capabilities";
import { useI18n } from "@/i18n";
import { useOverlays } from "@/store/overlays";
import Tooltip from "@/components/ui/Tooltip";

/**
 * Small status dot rendered next to the Sidebar brand. Replaces the
 * old fixed top-right CapabilityBadge — we
 * only surface global connection state inline when something is
 * actually wrong, and the full details live on /settings#connection.
 *
 * Colours:
 *   ready    → green
 *   degraded → amber (fsReadable+agent ok but a sub-system unreachable)
 *   no caps  → grey (probe hasn't run yet)
 */
export default function ConnectionDot() {
  const { caps } = useCapabilityStore();
  const { t } = useI18n();
  const openSettings = useOverlays((s) => s.openSettings);

  const mode = caps?.mode;
  const colour =
    mode === "ready" ? "var(--hms-success)" :
    mode === "degraded" ? "var(--hms-warning)" :
    "var(--hms-text-subtle, var(--hms-text-muted))";

  const tip =
    caps == null ? "..." :
    mode === "ready" ? t.connection.statusOk :
    (caps.reasons[0] ?? t.connection.statusDegraded);

  return (
    <Tooltip label={tip} placement="right">
      <button
        type="button"
        onClick={() => openSettings("connection")}
        aria-label={tip}
        style={{
          width: 16,
          height: 16,
          padding: 0,
          borderRadius: "999px",
          border: "1px solid var(--hms-border)",
          background: "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            display: "block",
            width: 8,
            height: 8,
            borderRadius: "999px",
            background: colour,
          }}
        />
      </button>
    </Tooltip>
  );
}
