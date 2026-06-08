import {
  Puzzle,
  Power,
  PowerOff,
  Trash2,
  ArrowUpCircle,
  Brain,
  Loader,
  Cpu,
  Wrench,
} from "lucide-react";
import { useI18n } from "@/i18n";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";
import {
  type Plugin,
  useEnablePlugin,
  useDisablePlugin,
  useUninstallPlugin,
  useUpdatePlugin,
} from "@/hooks/usePlugins";
import { useOverlays } from "@/store/overlays";

/**
 * PluginCard — one installed plugin rendered as a self-contained card.
 *
 * Replaces the old PluginSideList ↔ PluginDetail master-detail: the Plugins page
 * is a single scrolling column of these cards (grouped Memory / Active /
 * Disabled), so every plugin's controls are visible without a selection step.
 */
export default function PluginCard({
  plugin,
  memoryProvider,
  memoryOptions,
}: {
  plugin: Plugin;
  memoryProvider?: string | null;
  memoryOptions: Set<string>;
}) {
  const { t } = useI18n();
  const p = t.plugins;
  const openProfile = useOverlays((s) => s.openProfile);

  const enable = useEnablePlugin();
  const disable = useDisablePlugin();
  const uninstall = useUninstallPlugin();
  const update = useUpdatePlugin();

  const isEnabled = plugin.runtime_status === "enabled";
  const isInactive = plugin.runtime_status === "inactive";
  const isMemoryProvider = memoryOptions.has(plugin.name);
  const isActiveMemoryProvider = plugin.name === memoryProvider;
  const manifest = (plugin.dashboard_manifest ?? {}) as Record<string, unknown>;
  const supportsCtxLlm = manifest.ctx_llm === true || manifest.requires_ctx_llm === true;
  const hasToolOverride = Boolean(manifest.tool_override);

  const handleToggle = () => {
    if (isEnabled) disable.mutate(plugin.name);
    else enable.mutate(plugin.name);
  };

  const handleUninstall = () => {
    if (!plugin.can_remove) return;
    if (!window.confirm(`${p?.confirmUninstall ?? "Uninstall plugin"} ${plugin.name}?`)) return;
    uninstall.mutate(plugin.name);
  };

  const handleUpdate = () => {
    if (!plugin.can_update_git) return;
    update.mutate(plugin.name);
  };

  return (
    <div className="hms-plugin-card" data-inactive={isInactive || undefined}>
      <div className="hms-plugin-card-head">
        <div className="hms-plugin-card-icon">
          {isActiveMemoryProvider ? (
            <Brain size={20} className="hms-plugin-icon-success" />
          ) : supportsCtxLlm ? (
            <Cpu size={20} className="hms-plugin-icon-accent" />
          ) : (
            <Puzzle size={20} className={isEnabled ? "hms-plugin-icon-success" : "hms-plugin-icon-muted"} />
          )}
        </div>
        <div className="hms-plugin-card-main">
          <div className="hms-plugin-card-title">{plugin.name}</div>
          <div className="hms-plugin-card-badges">
            {plugin.version && (
              <StatusBadge tone="muted" uppercase={false}>v{plugin.version}</StatusBadge>
            )}
            {plugin.source && (
              <StatusBadge tone="muted" uppercase={false}>{plugin.source}</StatusBadge>
            )}
            {supportsCtxLlm && (
              <StatusBadge tone="accent" uppercase={false}>
                <Cpu size={10} /> ctx.llm
              </StatusBadge>
            )}
            {hasToolOverride && (
              <StatusBadge tone="warning" uppercase={false}>
                <Wrench size={10} /> tool override
              </StatusBadge>
            )}
            {isActiveMemoryProvider && (
              <StatusBadge tone="success" uppercase={false}>
                <Brain size={10} /> {p?.activeMemory ?? "active memory"}
              </StatusBadge>
            )}
          </div>
        </div>
      </div>

      {plugin.description && (
        <p className="hms-plugin-card-desc">{plugin.description}</p>
      )}

      {plugin.path && (
        <div>
          <div className="hms-plugin-card-path-label">Path</div>
          <code className="hms-plugin-card-path">{plugin.path}</code>
        </div>
      )}

      {plugin.auth_required && plugin.auth_command && (
        <div className="hms-plugin-auth-notice">
          <span className="hms-plugin-auth-label">{p?.authRequired ?? "Auth required"}:</span>
          <span>{p?.authHint ?? "Run"}</span>
          <code className="hms-plugin-auth-cmd">{plugin.auth_command}</code>
        </div>
      )}

      <div className="hms-plugin-card-actions">
        <Button size="sm" onClick={handleToggle} disabled={enable.isPending || disable.isPending}>
          {enable.isPending || disable.isPending ? (
            <Loader size={11} className="hms-spin" />
          ) : isEnabled ? (
            <PowerOff size={11} />
          ) : (
            <Power size={11} />
          )}
          {isEnabled ? (p?.disable ?? "Disable") : (p?.enable ?? "Enable")}
        </Button>

        {plugin.can_update_git && (
          <Button size="sm" onClick={handleUpdate} disabled={update.isPending}>
            {update.isPending ? <Loader size={11} className="hms-spin" /> : <ArrowUpCircle size={11} />}
            {p?.update ?? "Update"}
          </Button>
        )}

        {isMemoryProvider && (
          <Button size="sm" onClick={openProfile}>
            <Brain size={11} />
            {p?.manageMemory ?? "Manage memory"}
          </Button>
        )}

        {plugin.can_remove && (
          <Button size="sm" variant="danger" onClick={handleUninstall} disabled={uninstall.isPending}>
            {uninstall.isPending ? <Loader size={11} className="hms-spin" /> : <Trash2 size={11} />}
            {p?.uninstall ?? "Uninstall"}
          </Button>
        )}
      </div>
    </div>
  );
}
