import type { ReactNode } from "react";
import { WifiOff, ServerCrash, RefreshCw } from "lucide-react";
import { useCapabilityStore } from "@/store/capabilities";
import { useI18n } from "@/i18n";
import Button from "@/components/ui/Button";

/**
 * Capability gate wrapper.
 *
 * Renders `children` only when the required backend capability is available.
 * When the required capability is absent (or still loading), it renders a
 * friendly placeholder with a re-probe button rather than an error.
 *
 * - `require="agent"`:    `caps.agentReady` must be true
 * - `require="dashboard"`: `caps.dashboardReachable` must be true
 * - `require="any"`:      `caps.mode === "ready"` (both agent + dashboard OK)
 */
export default function CapabilityGate({
  require,
  children,
}: {
  require: "agent" | "dashboard" | "any";
  children: ReactNode;
}) {
  const { caps, loading, reprobe } = useCapabilityStore();
  const { t } = useI18n();
  const cap = t.capability;

  // While caps haven't loaded yet, pass through (avoids flickering placeholder
  // on normal startup).
  if (!caps) return <>{children}</>;

  const blocked =
    require === "agent"
      ? !caps.agentReady
      : require === "dashboard"
        ? !caps.dashboardReachable
        : caps.mode !== "ready";

  if (!blocked) return <>{children}</>;

  const Icon = require === "dashboard" ? WifiOff : ServerCrash;
  const heading =
    require === "dashboard"
      ? cap.gateDashboardHeading
      : require === "agent"
        ? cap.gateAgentHeading
        : cap.gateAnyHeading;
  const detail =
    require === "dashboard"
      ? cap.gateDashboardDetail
      : require === "agent"
        ? cap.gateAgentDetail
        : cap.gateAnyDetail;
  const reasons = caps.reasons ?? [];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--hms-space-4)",
        padding: "var(--hms-space-10) var(--hms-space-6)",
        color: "var(--hms-text-muted)",
        textAlign: "center",
      }}
    >
      <Icon size={40} strokeWidth={1.5} style={{ opacity: 0.5 }} />
      <div>
        <div
          style={{
            fontSize: "var(--hms-text-lg)",
            fontWeight: 600,
            color: "var(--hms-text)",
            marginBottom: "var(--hms-space-1)",
          }}
        >
          {heading}
        </div>
        <div style={{ fontSize: "var(--hms-text-sm)", maxWidth: 360 }}>{detail}</div>
        {reasons.length > 0 && (
          <ul
            style={{
              marginTop: "var(--hms-space-2)",
              paddingLeft: "var(--hms-space-4)",
              textAlign: "left",
              fontSize: "var(--hms-text-xs)",
            }}
          >
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
      <Button
        variant="default"
        size="sm"
        disabled={loading}
        onClick={() => void reprobe()}
        style={{ gap: "var(--hms-space-1)", display: "flex", alignItems: "center" }}
      >
        <RefreshCw size={14} />
        {cap.reprobe}
      </Button>
    </div>
  );
}
