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
      <div className="hms-settings-notice hms-settings-notice--info hms-cron-info-bar">
        <Info size={12} style={{ color: "var(--hms-accent)", flexShrink: 0 }} />
        <span>{c?.infoBarActive ?? "Cron jobs run while the gateway is active."}</span>
      </div>
    );
  }

  return (
    <div className="hms-settings-notice hms-settings-notice--warning hms-cron-info-bar">
      <AlertTriangle size={12} style={{ flexShrink: 0 }} />
      <span>{c?.infoBarStopped ?? "Gateway stopped — scheduled jobs won't fire."}</span>
    </div>
  );
}
