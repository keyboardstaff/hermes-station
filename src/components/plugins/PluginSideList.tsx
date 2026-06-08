import { useState } from "react";
import { Search, Puzzle, Brain, Cpu, Wrench } from "lucide-react";
import { useI18n } from "@/i18n";
import { usePlugins, type Plugin } from "@/hooks/usePlugins";
import { usePluginsSelection } from "@/store/panel-selection";

/**
 * PluginSideList — left-column list for PluginsPanel / PanelTwoColumn.
 *
 * Groups plugins into: Memory / Tools+CPU / Disabled.
 * Active row is highlighted. Clicking a row updates usePluginsSelection.
 */
export default function PluginSideList() {
  const { t } = useI18n();
  const p = t.plugins;
  const { data, isLoading, isError } = usePlugins();
  const selected = usePluginsSelection((s) => s.selectedName);
  const setSelected = usePluginsSelection((s) => s.setSelected);
  const [query, setQuery] = useState("");

  const plugins = data?.plugins ?? [];
  const memoryProvider = data?.providers?.memory_provider;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? plugins.filter(
        (pl) =>
          pl.name.toLowerCase().includes(q) ||
          pl.description?.toLowerCase().includes(q)
      )
    : plugins;

  // Group: memory > tools/active > disabled
  const memory = filtered.filter((pl) => pl.name === memoryProvider);
  const active = filtered.filter(
    (pl) => pl.runtime_status === "enabled" && pl.name !== memoryProvider
  );
  const disabled = filtered.filter((pl) => pl.runtime_status !== "enabled");

  const groups: { label: string; items: Plugin[] }[] = [
    ...(memory.length > 0 ? [{ label: p?.groupMemory ?? "Memory", items: memory }] : []),
    ...(active.length > 0 ? [{ label: p?.groupActive ?? "Active", items: active }] : []),
    ...(disabled.length > 0 ? [{ label: p?.groupDisabled ?? "Disabled", items: disabled }] : []),
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Search */}
      <div style={{ padding: "8px 10px", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <Search
            size={12}
            style={{
              position: "absolute",
              left: 8,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--hms-text-muted)",
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={p?.searchPlaceholder ?? "Search plugins…"}
            style={{
              width: "100%",
              padding: "5px 8px 5px 26px",
              fontSize: "var(--hms-text-caption)",
              background: "var(--hms-bg)",
              border: "1px solid var(--hms-border)",
              borderRadius: 6,
              color: "var(--hms-text)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {/* List body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px" }}>
        {isLoading && (
          <div style={{ padding: "12px 8px", color: "var(--hms-text-muted)", fontSize: "var(--hms-text-sm)" }}>
            {p?.loading ?? "Loading…"}
          </div>
        )}
        {isError && (
          <div style={{ padding: "12px 8px", color: "var(--hms-error-text)", fontSize: "var(--hms-text-sm)" }}>
            {p?.errorLoading ?? "Failed to load plugins."}
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <div style={{ padding: "12px 8px", color: "var(--hms-text-muted)", fontSize: "var(--hms-text-sm)" }}>
            {q ? p?.noMatches ?? "No matches." : p?.noPlugins ?? "No plugins installed."}
          </div>
        )}

        {groups.map((group) => (
          <div key={group.label}>
            <div
              style={{
                padding: "8px 8px 2px",
                fontSize: "var(--hms-text-xs)",
                fontWeight: 600,
                color: "var(--hms-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {group.label}
            </div>
            {group.items.map((pl) => (
              <PluginRow
                key={pl.name}
                plugin={pl}
                isActive={selected === pl.name}
                isMemoryProvider={pl.name === memoryProvider}
                onClick={() => setSelected(pl.name)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PluginRow({
  plugin,
  isActive,
  isMemoryProvider,
  onClick,
}: {
  plugin: Plugin;
  isActive: boolean;
  isMemoryProvider: boolean;
  onClick: () => void;
}) {
  const isEnabled = plugin.runtime_status === "enabled";
  const manifest = plugin.dashboard_manifest ?? {};
  const supportsCtxLlm =
    (manifest as Record<string, unknown>).ctx_llm === true ||
    (manifest as Record<string, unknown>).requires_ctx_llm === true;
  const hasToolOverride = Boolean((manifest as Record<string, unknown>).tool_override);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--hms-space-2)",
        width: "100%",
        padding: "7px 8px",
        borderRadius: 6,
        border: "none",
        background: isActive ? "var(--hms-surface-hover)" : "transparent",
        color: "var(--hms-text)",
        cursor: "pointer",
        textAlign: "left",
        opacity: plugin.runtime_status === "inactive" ? 0.6 : 1,
      }}
    >
      {isMemoryProvider ? (
        <Brain size={13} style={{ color: "var(--hms-success)", flexShrink: 0 }} />
      ) : supportsCtxLlm ? (
        <Cpu size={13} style={{ color: "var(--hms-accent)", flexShrink: 0 }} />
      ) : hasToolOverride ? (
        <Wrench size={13} style={{ color: "var(--hms-warning)", flexShrink: 0 }} />
      ) : (
        <Puzzle size={13} style={{ color: isEnabled ? "var(--hms-success)" : "var(--hms-text-muted)", flexShrink: 0 }} />
      )}
      <span
        style={{
          flex: 1,
          fontSize: "var(--hms-text-sm)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {plugin.name}
      </span>
      {plugin.version && (
        <span style={{ fontSize: "0.625rem", color: "var(--hms-text-muted)", flexShrink: 0 }}>
          v{plugin.version}
        </span>
      )}
    </button>
  );
}
