import { useI18n } from "@/i18n";
import { usePlugins } from "@/hooks/usePlugins";
import { usePluginsSelection } from "@/store/panel-selection";
import CapabilityGate from "@/components/ui/CapabilityGate";
import PageTopBar from "@/components/layout/PageTopBar";
import PanelTwoColumn from "@/components/ui/PanelTwoColumn";
import IconButton from "@/components/ui/IconButton";
import PluginSideList from "@/components/plugins/PluginSideList";
import PluginDetail from "@/components/plugins/PluginDetail";
import RuntimeProvidersCard from "@/components/plugins/RuntimeProvidersCard";
import GitInstallCard from "@/components/plugins/GitInstallCard";
import { RefreshCw } from "lucide-react";

/**
 * Plugins panel — runtime-provider + git-install modules on top, then the
 * installed plugin list↔detail (grouped by status). Data via usePlugins.
 */
export default function PluginsPanel() {
  const { t } = useI18n();
  const p = t.plugins;
  const { refetch } = usePlugins();
  const selected = usePluginsSelection((s) => s.selectedName);
  const setSelected = usePluginsSelection((s) => s.setSelected);

  return (
    <CapabilityGate require="agent">
      <div className="hms-plugins">
        <PageTopBar
          title={t.nav.plugins}
          actions={
            <IconButton title={p?.refresh ?? "Refresh"} onClick={() => refetch()}>
              <RefreshCw size={14} />
            </IconButton>
          }
        />
        <div className="hms-plugins-body">
          <div className="hms-plugins-config">
            <RuntimeProvidersCard />
            <GitInstallCard />
            <h3 className="hms-plugins-section">
              {p?.installedTitle ?? "Installed plugins"}
            </h3>
          </div>
          <div className="hms-plugins-browser">
            <PanelTwoColumn
              list={<PluginSideList />}
              detail={<PluginDetail />}
              hasSelection={!!selected}
              onBack={() => setSelected(null)}
            />
          </div>
        </div>
      </div>
    </CapabilityGate>
  );
}
