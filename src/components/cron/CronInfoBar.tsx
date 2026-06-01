import { Info, AlertTriangle } from "lucide-react";
import { useCapabilityStore } from "@/store/capabilities";
import { useI18n } from "@/i18n";

/**
 * CronInfoBar — shows gateway status above the cron job list.
 *
 * - agentReady=true: subtle blue info bar ("Jobs run while the gateway is active.")
 * - agentReady=false: orange warning bar ("Gateway stopped — jobs won't fire.")
 *
 * Hidden when capabilities are still loading (caps is null).
 */
export default function CronInfoBar() {
  const { caps } = useCapabilityStore();
  const { t } = useI18n();
  const c = t.cron;

  if (!caps) return null;

  const agentReady = caps.agentReady;

  if (agentReady) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--hms-space-2)",
          padding: "8px 12px",
          background: "rgba(99,102,241,0.06)",
          border: "1px solid rgba(99,102,241,0.18)",
          borderRadius: 6,
          fontSize: "var(--hms-text-xs)",
          color: "var(--hms-text-muted)",
          margin: "8px 10px 0",
          flexShrink: 0,
        }}
      >
        <Info size={12} style={{ color: "var(--hms-accent)", flexShrink: 0 }} />
        <span>{c?.infoBarActive ?? "Cron jobs run while the gateway is active."}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--hms-space-2)",
        padding: "8px 12px",
        background: "rgba(245,158,11,0.06)",
        border: "1px solid rgba(245,158,11,0.18)",
        borderRadius: 6,
        fontSize: "var(--hms-text-xs)",
        color: "var(--hms-warning-text)",
        margin: "8px 10px 0",
        flexShrink: 0,
      }}
    >
      <AlertTriangle size={12} style={{ flexShrink: 0 }} />
      <span>{c?.infoBarStopped ?? "Gateway stopped — scheduled jobs won't fire."}</span>
    </div>
  );
}
