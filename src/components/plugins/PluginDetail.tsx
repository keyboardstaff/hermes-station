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
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/i18n";
import Button from "@/components/ui/Button";
import {
  usePlugins,
  useEnablePlugin,
  useDisablePlugin,
  useUninstallPlugin,
  useUpdatePlugin,
} from "@/hooks/usePlugins";
import { usePluginsSelection } from "@/store/panel-selection";

/**
 * PluginDetail — right-column detail pane for PluginsPanel / PanelTwoColumn.
 *
 * Reads selectedName from usePluginsSelection and looks up the plugin
 * data from the shared usePlugins cache (no extra fetch).
 */
export default function PluginDetail() {
  const { t } = useI18n();
  const p = t.plugins;
  const navigate = useNavigate();
  const selected = usePluginsSelection((s) => s.selectedName);
  const setSelected = usePluginsSelection((s) => s.setSelected);
  const { data } = usePlugins();

  const enable = useEnablePlugin();
  const disable = useDisablePlugin();
  const uninstall = useUninstallPlugin();
  const update = useUpdatePlugin();

  const plugins = data?.plugins ?? [];
  const memoryProvider = data?.providers?.memory_provider;
  const memoryOptions = new Set(data?.providers?.memory_options?.map((o) => o.name) ?? []);

  const plugin = plugins.find((pl) => pl.name === selected);

  if (!plugin) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--hms-text-muted)",
          fontSize: "var(--hms-text-sm)",
        }}
      >
        {p?.selectPlugin ?? "Select a plugin to see details."}
      </div>
    );
  }

  const isEnabled = plugin.runtime_status === "enabled";
  const isInactive = plugin.runtime_status === "inactive";
  const isMemoryProvider = memoryOptions.has(plugin.name);
  const isActiveMemoryProvider = plugin.name === memoryProvider;
  const manifest = plugin.dashboard_manifest ?? {};
  const supportsCtxLlm =
    (manifest as Record<string, unknown>).ctx_llm === true ||
    (manifest as Record<string, unknown>).requires_ctx_llm === true;
  const hasToolOverride = Boolean((manifest as Record<string, unknown>).tool_override);

  const handleToggle = () => {
    if (isEnabled) disable.mutate(plugin.name);
    else enable.mutate(plugin.name);
  };

  const handleUninstall = () => {
    if (!plugin.can_remove) return;
    if (!window.confirm(`${p?.confirmUninstall ?? "Uninstall plugin"} ${plugin.name}?`)) return;
    uninstall.mutate(plugin.name);
    setSelected(null);
  };

  const handleUpdate = () => {
    if (!plugin.can_update_git) return;
    update.mutate(plugin.name);
  };

  return (
    <div
      style={{
        padding: "var(--hms-space-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--hms-space-4)",
        opacity: isInactive ? 0.6 : 1,
        maxWidth: 640,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--hms-space-3)" }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "var(--hms-surface-hover)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {isActiveMemoryProvider ? (
            <Brain size={20} style={{ color: "var(--hms-success)" }} />
          ) : supportsCtxLlm ? (
            <Cpu size={20} style={{ color: "var(--hms-accent)" }} />
          ) : (
            <Puzzle size={20} style={{ color: isEnabled ? "var(--hms-success)" : "#94a3b8" }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--hms-text-lg, 1.125rem)", fontWeight: 700 }}>{plugin.name}</div>
          <div style={{ display: "flex", gap: "var(--hms-space-2)", flexWrap: "wrap", marginTop: 4 }}>
            {plugin.version && (
              <span style={badgeStyle("var(--hms-text-muted)")}>v{plugin.version}</span>
            )}
            {plugin.source && (
              <span style={badgeStyle("var(--hms-text-muted)")}>{plugin.source}</span>
            )}
            {supportsCtxLlm && (
              <span style={badgeStyle("var(--hms-accent)")}>
                <Cpu size={10} /> ctx.llm
              </span>
            )}
            {hasToolOverride && (
              <span style={badgeStyle("var(--hms-warning)")}>
                <Wrench size={10} /> tool override
              </span>
            )}
            {isActiveMemoryProvider && (
              <span style={badgeStyle("var(--hms-success)")}>
                <Brain size={10} /> {p?.activeMemory ?? "active memory"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {plugin.description && (
        <p style={{ margin: 0, fontSize: "var(--hms-text-body)", color: "var(--hms-text-muted)", lineHeight: 1.6 }}>
          {plugin.description}
        </p>
      )}

      {/* Path */}
      {plugin.path && (
        <div>
          <div style={{ fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)", marginBottom: 4 }}>
            Path
          </div>
          <code
            style={{
              display: "block",
              fontSize: "0.7rem",
              padding: "6px 10px",
              background: "var(--hms-surface-hover)",
              borderRadius: 6,
              wordBreak: "break-all",
              color: "var(--hms-text-muted)",
            }}
          >
            {plugin.path}
          </code>
        </div>
      )}

      {/* Auth hint */}
      {plugin.auth_required && plugin.auth_command && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--hms-space-2)",
            padding: "8px 12px",
            background: "rgba(245,158,11,0.06)",
            border: "1px solid rgba(245,158,11,0.18)",
            borderRadius: 8,
            fontSize: "var(--hms-text-xs)",
            color: "var(--hms-warning-text)",
          }}
        >
          <span style={{ fontWeight: 600 }}>{p?.authRequired ?? "Auth required"}:</span>
          <span>{p?.authHint ?? "Run"}</span>
          <code style={{ fontSize: "0.7rem" }}>{plugin.auth_command}</code>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "var(--hms-space-2)", flexWrap: "wrap" }}>
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
          <Button size="sm" onClick={() => navigate("/profile")}>
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

function badgeStyle(color: string): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--hms-space-1)",
    fontSize: "0.5625rem",
    padding: "2px 6px",
    borderRadius: 4,
    fontWeight: 600,
    color,
    background: `${color}1a`,
    border: `1px solid ${color}33`,
  };
}
